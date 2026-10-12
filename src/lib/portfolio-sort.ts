import type { CollectionEntry } from 'astro:content';

/** Build a sortable date string. If `date` is set, use it; otherwise fall
 *  back to year-01-01 so dated entries always beat undated ones in the same
 *  year. Slug Z→A is used as a final tiebreaker. */
export function sortPortfolioDesc(
  entries: CollectionEntry<'portfolio'>[]
): CollectionEntry<'portfolio'>[] {
  return entries.slice().sort((a, b) => {
    const ad = a.data.date ?? `${a.data.year}-01-01`;
    const bd = b.data.date ?? `${b.data.year}-01-01`;
    if (bd !== ad) return bd.localeCompare(ad);
    return b.slug.localeCompare(a.slug);
  });
}
