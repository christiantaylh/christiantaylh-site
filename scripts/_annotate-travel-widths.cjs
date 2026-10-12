const fs = require('fs');
const path = require('path');
const { load } = require('cheerio');
const matter = require('gray-matter');

const SOURCE = 'https://christiantaylh.myportfolio.com';
const MD_DIR = 'src/content/travel-journal';
const UA = 'Mozilla/5.0 (compatible; christiantaylh-site-migration)';

// slug → source path overrides
const SRC = { 'iceland-2017': 'iceland', 'iceland-2019': 'after-effect-loops', 'beijing': 'china' };
const uuid = (u) => (String(u).match(/([a-f0-9-]{36})/) || [])[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function annotate(slug) {
  const fp = path.join(MD_DIR, slug + '.md');
  if (!fs.existsSync(fp)) return;
  const srcSlug = SRC[slug] || slug;
  const res = await fetch(`${SOURCE}/${srcSlug}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) { console.log(`  ${slug}: fetch ${res.status}`); return; }
  const html = await res.text();
  const $ = load(html);

  // Ordered image-module UUIDs (matches local file numbering 01..N)
  const order = [];
  $('.js-project-modules .project-module.project-module-image, .js-project-modules .project-module-image').each((i, el) => {
    const id = uuid($(el).find('img[data-src]').attr('data-src') || '');
    if (id) order.push(id);
  });

  // UUIDs that live in a tree row of 2+ images → 'half'
  const halves = new Set();
  $('.js-project-modules .project-module-tree').each((i, el) => {
    const ids = $(el).find('img[data-src]').map((j, im) => uuid($(im).attr('data-src') || '')).get().filter(Boolean);
    if (ids.length >= 2) ids.forEach((id) => halves.add(id));
  });

  const widthByPos = order.map((id) => (halves.has(id) ? 'half' : 'full'));

  // Apply to .md image blocks in order
  const parsed = matter(fs.readFileSync(fp, 'utf8'));
  let pos = 0;
  for (const block of parsed.data.body || []) {
    if (block.type === 'image') {
      block.width = widthByPos[pos] || 'full';
      pos++;
    }
  }
  fs.writeFileSync(fp, matter.stringify(parsed.content, parsed.data, { lineWidth: -1 }));
  const halfN = widthByPos.filter((w) => w === 'half').length;
  console.log(`  ${slug}: ${order.length} images, ${halfN} half / ${order.length - halfN} full`);
}

(async () => {
  const targets = process.argv.slice(2);
  for (const slug of targets) { await annotate(slug); await sleep(400); }
})();
