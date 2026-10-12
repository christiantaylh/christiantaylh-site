import { getEntry } from 'astro:content';

export async function getSiteSettings() {
  const entry = await getEntry('site', 'general');
  if (!entry) {
    throw new Error(
      'Missing src/content/site/general.md — required singleton entry.'
    );
  }
  return entry.data;
}
