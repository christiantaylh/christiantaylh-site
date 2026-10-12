/**
 * Travel Journal scraper for christiantaylh.myportfolio.com → src/content/travel-journal/.
 *
 *   npm run scrape:travel:dry     preview, no downloads or .md writes
 *   npm run scrape:travel         do it for real
 *
 * Source-site quirks (from the original brief):
 *   - Iceland appears twice. /iceland is Iceland 2017; /after-effect-loops
 *     is Iceland 2019 (Adobe Portfolio kept the original slug). Use the
 *     visible label not the URL slug.
 *   - "New South Whales" on the source is a typo — render as "New South Wales".
 *
 * Per-destination output:
 *   public/uploads/travel-journal/<slug>/01.jpg, 02.jpg, …
 *   src/content/travel-journal/<slug>.md
 *
 * Idempotent: re-running skips destinations that already have a .md file.
 * Concurrency: 2 destinations in flight, 500ms politeness delay per fetch.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { load, type CheerioAPI } from 'cheerio';
import pLimit from 'p-limit';

const SOURCE = 'https://christiantaylh.myportfolio.com';
const LISTING_PATH = '/photojournals';
const UA = 'Mozilla/5.0 (compatible; christiantaylh-site-migration)';

const MD_DIR = 'src/content/travel-journal';
const UPLOAD_BASE = 'public/uploads/travel-journal';

const DRY_RUN = process.argv.includes('--dry-run');
const POLITENESS_MS = 500;
const CONCURRENCY = 2;

interface Destination {
  sourceSlug: string;       // URL slug on Adobe Portfolio
  destSlug: string;         // Output slug for our content collection
  title: string;
  location: string;
  year: number;
}

interface BodyImage { type: 'image'; src: string; alt: string }
interface BodyText { type: 'text'; body: string }
type BodyBlock = BodyImage | BodyText;

interface Gallery {
  dest: Destination;
  introHtml?: string;
  body: BodyBlock[];
}

// ─── HTTP helpers ───────────────────────────────────────────────────────

let lastFetch = 0;
async function politeFetch(url: string): Promise<Response> {
  const wait = Math.max(0, lastFetch + POLITENESS_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await politeFetch(url);
  return res.text();
}

async function downloadTo(url: string, fsPath: string): Promise<number> {
  if (DRY_RUN) return 0;
  const res = await politeFetch(url);
  await fs.mkdir(path.dirname(fsPath), { recursive: true });
  const fileHandle = await fs.open(fsPath, 'w');
  const writeStream = fileHandle.createWriteStream();
  await finished(Readable.fromWeb(res.body as never).pipe(writeStream));
  const stat = await fs.stat(fsPath);
  return stat.size;
}

// ─── Parsing ────────────────────────────────────────────────────────────

/**
 * Map Adobe Portfolio "Label YYYY" → destination metadata, applying the
 * Iceland disambiguation and the New South Wales typo fix.
 */
function deriveDestination(sourceSlug: string, rawLabel: string): Destination | null {
  // Strip the URL prefix
  const slug = sourceSlug.replace(/^\//, '');
  // Year is the trailing 4-digit number
  const yearMatch = rawLabel.match(/^(.*?)\s+(\d{4})$/);
  if (!yearMatch) return null;
  const labelPart = yearMatch[1].trim();
  const year = Number(yearMatch[2]);

  // Iceland disambiguation
  if (slug === 'iceland' && year === 2017) {
    return { sourceSlug: slug, destSlug: 'iceland-2017', title: 'Iceland', location: 'Iceland', year };
  }
  if (slug === 'after-effect-loops' && year === 2019) {
    return { sourceSlug: slug, destSlug: 'iceland-2019', title: 'Iceland', location: 'Iceland', year };
  }
  // Source slug /china is published as "Beijing".
  if (slug === 'china') {
    return { sourceSlug: slug, destSlug: 'beijing', title: 'Beijing', location: 'Beijing', year };
  }

  // Typo fix
  const title = labelPart === 'New South Whales' ? 'New South Wales' : labelPart;
  return { sourceSlug: slug, destSlug: slug, title, location: title, year };
}

function parseListing(html: string): Destination[] {
  const $ = load(html);
  const out: Destination[] = [];
  $('a[href^="/"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (href === '/photojournals' || href === '/') return;
    if (!/^\/[a-z0-9-]+$/.test(href)) return;
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!label) return;
    const dest = deriveDestination(href, label);
    if (!dest) return;
    // De-dup (Adobe lists tiles twice in some themes)
    if (out.some((d) => d.destSlug === dest.destSlug)) return;
    out.push(dest);
  });
  return out;
}

/**
 * Pick the highest-res variant of a CDN image. Adobe Portfolio gives several
 * sizes via data-srcset; we prefer the explicit `_rw_3840` suffix when it's
 * present (true full-bleed), otherwise the largest entry in the srcset.
 */
function pickFullSizeImage($img: ReturnType<CheerioAPI>): string | null {
  const dataSrc = $img.attr('data-src') ?? '';
  if (dataSrc.includes('_rw_3840')) return dataSrc;

  const srcset = $img.attr('data-srcset') ?? $img.attr('srcset') ?? '';
  if (srcset) {
    const candidates = srcset.split(',').map((s) => s.trim()).filter(Boolean);
    let bestUrl = '';
    let bestWidth = 0;
    for (const c of candidates) {
      const m = c.match(/^(\S+)\s+(\d+)w$/);
      if (!m) continue;
      const w = Number(m[2]);
      if (w > bestWidth) {
        bestWidth = w;
        bestUrl = m[1];
      }
    }
    if (bestUrl) return bestUrl;
  }

  // Last resort: prefer `_rw_*` over `_carw_` thumbnail variants
  if (dataSrc.includes('_rw_')) return dataSrc;
  return dataSrc || null;
}

function htmlToPlainText(html: string): string {
  // Convert <br> to newlines, strip remaining tags. Adobe Portfolio's text
  // modules are usually plain paragraphs; we keep blank lines between them.
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return withBreaks
    .replace(/ /g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseGallery(html: string, dest: Destination): Gallery {
  const $ = load(html);
  const body: BodyBlock[] = [];

  // Iterate top-level project modules in order. Adobe Portfolio includes a
  // "You may also like" cover-grid module at the end of every gallery, plus
  // sometimes a covers row inside; both use `_carw_*` cropped thumbnails.
  // We skip any image whose URL is a carousel-cover variant.
  const isCarouselCover = (src: string): boolean => /(_carw_|_rwc_0x|cover__img)/.test(src);

  // Use descendant selector — some Adobe Portfolio themes wrap each module
  // in an extra container so `>` doesn't catch them.
  $('.js-project-modules .project-module').each((_i, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    // Skip explicit cover/grid/related modules entirely.
    if (/(cover|grid|covers|related|navigation|footer)/i.test(cls)) return;

    if (cls.includes('image')) {
      const $img = $el.find('img').first();
      const src = pickFullSizeImage($img);
      if (!src || isCarouselCover(src)) return;
      const alt = ($img.attr('alt') ?? '').trim() || dest.title;
      body.push({ type: 'image', src, alt });
    } else if (cls.includes('media_collection') || cls.includes('media-collection')) {
      // Multi-image module: gallery rows, grids, etc.
      $el.find('img').each((_j, imgEl) => {
        const $img = $(imgEl);
        const src = pickFullSizeImage($img);
        if (!src || isCarouselCover(src)) return;
        const alt = ($img.attr('alt') ?? '').trim() || dest.title;
        body.push({ type: 'image', src, alt });
      });
    } else if (cls.includes('text') || $el.find('.rich-text').length) {
      const richHtml = $el.find('.rich-text').html() ?? $el.html() ?? '';
      const text = htmlToPlainText(richHtml);
      if (text) body.push({ type: 'text', body: text });
    }
  });

  // Fallback: if we found no modules but there are images on the page, take
  // every standalone full-res image as a fallback (some galleries don't use
  // the standard module wrapper).
  if (body.length === 0) {
    $('img').each((_i, el) => {
      const src = pickFullSizeImage($(el));
      if (src && /myportfolio\.com/.test(src)) {
        body.push({ type: 'image', src, alt: dest.title });
      }
    });
  }

  return { dest, body };
}

// ─── Writing ────────────────────────────────────────────────────────────

function fileExtensionFromUrl(url: string): string {
  const m = url.match(/\.(jpe?g|png|webp|avif)(?:\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

function yamlEscape(s: string): string {
  if (/^[A-Za-z0-9 .,:'"!?()\-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function frontmatterFor(g: Gallery, heroPath: string): string {
  const lines: string[] = [
    '---',
    `title: ${yamlEscape(g.dest.title)}`,
    `location: ${yamlEscape(g.dest.location)}`,
    `year: ${g.dest.year}`,
    `hero_image: ${heroPath}`,
  ];
  if (g.introHtml) {
    const intro = htmlToPlainText(g.introHtml);
    if (intro) lines.push(`intro: ${yamlEscape(intro)}`);
  }
  if (g.body.length) {
    lines.push('body:');
    for (const block of g.body) {
      if (block.type === 'image') {
        lines.push(`  - type: image`);
        lines.push(`    src: ${block.src}`);
        lines.push(`    alt: ${yamlEscape(block.alt)}`);
      } else {
        lines.push(`  - type: text`);
        lines.push(`    body: ${yamlEscape(block.body)}`);
      }
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

async function migrateOne(dest: Destination): Promise<void> {
  const mdPath = path.join(MD_DIR, `${dest.destSlug}.md`);
  if (existsSync(mdPath)) {
    console.log(`  skip ${dest.destSlug}.md (already exists)`);
    return;
  }

  console.log(`→ ${dest.destSlug}  (${dest.title} ${dest.year})  /${dest.sourceSlug}`);
  const html = await fetchHtml(`${SOURCE}/${dest.sourceSlug}`);
  const gallery = parseGallery(html, dest);

  if (gallery.body.length === 0) {
    console.log(`  ⚠ no images parsed`);
    return;
  }

  // Download images, rewrite body to local paths.
  const uploadDir = path.join(UPLOAD_BASE, dest.destSlug);
  if (!DRY_RUN) await fs.mkdir(uploadDir, { recursive: true });

  let imgIdx = 0;
  for (const block of gallery.body) {
    if (block.type !== 'image') continue;
    imgIdx++;
    const num = String(imgIdx).padStart(2, '0');
    const ext = fileExtensionFromUrl(block.src);
    const filename = `${num}${ext}`;
    const filePath = path.join(uploadDir, filename);
    const publicPath = `/uploads/travel-journal/${dest.destSlug}/${filename}`;

    if (DRY_RUN) {
      console.log(`  ${num}  ←  ${block.src}`);
    } else {
      const bytes = await downloadTo(block.src, filePath);
      console.log(`  ${num}  ${(bytes / 1024).toFixed(0)}KB  ${filename}`);
    }
    block.src = publicPath;
  }

  // hero_image is the first image
  const firstImg = gallery.body.find((b): b is BodyImage => b.type === 'image');
  if (!firstImg) return;
  const hero = firstImg.src;

  const md = frontmatterFor(gallery, hero);
  if (DRY_RUN) {
    console.log(`  (would write) ${mdPath}  ${md.length} bytes`);
  } else {
    await fs.writeFile(mdPath, md, 'utf8');
    console.log(`  wrote ${mdPath}`);
  }
}

async function main() {
  console.log(`[scrape] source: ${SOURCE}${LISTING_PATH}`);
  console.log(`[scrape] mode:   ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const listingHtml = await fetchHtml(`${SOURCE}${LISTING_PATH}`);
  const destinations = parseListing(listingHtml);
  console.log(`[scrape] destinations: ${destinations.length}`);

  if (!DRY_RUN) {
    await fs.mkdir(MD_DIR, { recursive: true });
    await fs.mkdir(UPLOAD_BASE, { recursive: true });
  }

  const limit = pLimit(CONCURRENCY);
  await Promise.all(destinations.map((d) => limit(() => migrateOne(d).catch((e) => {
    console.error(`  ✕ ${d.destSlug}: ${e instanceof Error ? e.message : String(e)}`);
  }))));

  console.log('\n[scrape] done.');
}

main().catch((err) => {
  console.error('[scrape] fatal:', err);
  process.exitCode = 1;
});
