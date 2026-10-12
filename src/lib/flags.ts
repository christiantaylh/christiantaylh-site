/**
 * Site-wide feature flags.
 *
 * Flip these to hide/show major sections without deleting any content.
 * Pages at the hidden route still render (so they can be previewed via direct
 * URL during editing), but all internal navigation links are suppressed.
 */

export const flags = {
  /** Show "Travel Journal" in sidebar + mobile nav. */
  showTravelJournal: false,
} as const;
