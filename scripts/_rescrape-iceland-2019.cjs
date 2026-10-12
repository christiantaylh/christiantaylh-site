// One-off rescrape for a single travel-journal slug.
// Usage:  node scripts/_rescrape-iceland-2019.cjs <destSlug> <sourceSlug>
// Default: iceland-2019 ← /after-effect-loops
//
// Pulls fresh images including tree-module rows (the standard scraper
// skipped these), downloads them, converts to AVIF, and rewrites the .md
// with width hints. Preserves the existing `order` field.

const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');
const sharp = require('sharp');
const matter = require('gray-matter');

const DEST_SLUG = process.argv[2] || 'iceland-2019';
const SOURCE_SLUG = process.argv[3] || 'after-effect-loops';
const SOURCE = 'https://christiantaylh.myportfolio.com/' + SOURCE_SLUG;
const UA = 'Mozilla/5.0 (compatible; christiantaylh-site-migration)';
const SLUG = DEST_SLUG;
const UPLOAD_DIR = path.join('public/uploads/travel-journal', SLUG);
const MD_PATH = path.join('src/content/travel-journal', SLUG + '.md');

function pickFullSize($img) {
  const dataSrc = $img.attr('data-src') || '';
  if (dataSrc.includes('_rw_3840')) return dataSrc;
  const srcset = $img.attr('data-srcset') || $img.attr('srcset') || '';
  if (srcset) {
    let bestUrl = '', bestW = 0;
    for (const c of srcset.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = c.match(/^(\S+)\s+(\d+)w$/);
      if (!m) continue;
      const w = Number(m[2]);
      if (w > bestW) { bestW = w; bestUrl = m[1]; }
    }
    if (bestUrl) return bestUrl;
  }
  return dataSrc;
}

const isCarouselCover = (s) => /(_carw_|_rwc_0x|cover__img)/.test(s);

function htmlToPlainText(html) {
  const withBreaks = String(html || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return withBreaks
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

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(url + ' ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, buf);
  return buf.length;
}

(async () => {
  const existing = fs.existsSync(MD_PATH) ? matter(fs.readFileSync(MD_PATH, 'utf8')) : null;
  const preservedOrder = existing && existing.data.order;
  const altText = (existing && (existing.data.location || existing.data.title)) || 'Photo';

  console.log('fetching', SOURCE);
  const html = await (await fetch(SOURCE, { headers: { 'User-Agent': UA } })).text();
  const $ = load(html);

  // Parse modules in order. Images carry full|half hints (tree = half).
  // Text modules are interleaved at their source position.
  // Filter out nested modules — Adobe Portfolio nests inner image modules
  // inside tree modules, and we want only the outermost wrapper at each
  // position. Some themes wrap each top-level module in an extra container,
  // so a direct-child selector misses them; use descendant + ancestor check.
  const items = [];
  $('.js-project-modules .project-module').each((_i, el) => {
    const $el = $(el);
    const cls = $el.attr('class') || '';
    if (/(cover|grid|covers|related|navigation|footer)/i.test(cls)) return;
    // Skip if this module sits inside another .project-module (e.g. an
    // image module nested inside a tree row).
    if ($el.parents('.project-module').length > 0) return;

    if (cls.includes('project-module-tree')) {
      const halves = [];
      $el.find('img').each((_j, imgEl) => {
        const src = pickFullSize($(imgEl));
        if (src && !isCarouselCover(src)) halves.push(src);
      });
      halves.forEach((src) => items.push({ kind: 'image', src, width: 'half' }));
    } else if (cls.includes('image')) {
      const src = pickFullSize($el.find('img').first());
      if (src && !isCarouselCover(src)) items.push({ kind: 'image', src, width: 'full' });
    } else if (cls.includes('media_collection') || cls.includes('media-collection')) {
      $el.find('img').each((_j, imgEl) => {
        const src = pickFullSize($(imgEl));
        if (src && !isCarouselCover(src)) items.push({ kind: 'image', src, width: 'half' });
      });
    } else if (cls.includes('text') || $el.find('.rich-text').length) {
      const richHtml = $el.find('.rich-text').html() || $el.html() || '';
      const text = htmlToPlainText(richHtml);
      if (text) items.push({ kind: 'text', body: text });
    }
  });

  const imgN = items.filter((x) => x.kind === 'image').length;
  const txtN = items.filter((x) => x.kind === 'text').length;
  console.log('found', imgN, 'images and', txtN, 'text blocks');

  // Clear existing image files in folder, then download fresh and convert
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (/^\d+\.(jpe?g|avif|png|webp)$/i.test(f)) fs.unlinkSync(path.join(UPLOAD_DIR, f));
    }
  }
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });

  const body = [];
  let imgIdx = 0;
  for (const it of items) {
    if (it.kind === 'text') {
      body.push({ type: 'text', body: it.body });
      continue;
    }
    imgIdx++;
    const num = String(imgIdx).padStart(2, '0');
    const tmpJpg = path.join('/tmp', SLUG + '-' + num + '.jpg');
    const avif = path.join(UPLOAD_DIR, num + '.avif');
    process.stdout.write('  ' + num + ' ');
    const bytes = await download(it.src, tmpJpg);
    const info = await sharp(tmpJpg).rotate().avif({ quality: 60 }).toFile(avif);
    console.log((bytes / 1024).toFixed(0) + 'KB jpg -> ' + (info.size / 1024).toFixed(0) + 'KB avif  ' + it.width);
    fs.unlinkSync(tmpJpg);
    body.push({
      type: 'image',
      src: '/uploads/travel-journal/' + SLUG + '/' + num + '.avif',
      alt: altText,
      width: it.width,
    });
  }

  // Write the .md, preserving title/location/year/order from existing file.
  const oldData = existing ? existing.data : {};
  const data = {
    title: oldData.title || 'Untitled',
    location: oldData.location || oldData.title || 'Untitled',
    year: oldData.year,
    hero_image: '/uploads/travel-journal/' + SLUG + '/01.avif',
    body,
  };
  if (oldData.intro) data.intro = oldData.intro;
  if (preservedOrder !== undefined) data.order = preservedOrder;
  fs.writeFileSync(MD_PATH, matter.stringify('', data, { lineWidth: -1 }));
  console.log('wrote', MD_PATH);
})().catch((e) => { console.error(e); process.exit(1); });
