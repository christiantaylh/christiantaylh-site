import { defineCollection, z } from 'astro:content';

const EQUIPMENT = [
  'Sony A7V',
  'Sony A7 IV',
  'Sony A7 III',
  'Sony FX3',
  'Sony FX30',
  'DJI Mavic 3 Pro',
  'DJI Mavic 3 Pro Cine',
  'GEPRC Vapor D5',
  'GEPRC Darkstar 22',
] as const;

const CATEGORIES = ['Film', 'Commercial', 'Personal', 'Live Event'] as const;

const TAGS = [
  'Drone',
  'Cinematic',
  'Commercial',
  'Documentary',
  'Music Video',
  'Travel',
  'Real Estate',
  'Event',
] as const;

const PHOTO_COLLECTIONS = ['sport', 'landscape', 'nature', 'calle-en-cuadro', 'aerials'] as const;

const site = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    title: z.string(),
    bio: z.string().optional(),
    tagline: z.string(),
    avatar: z.string(),
    email: z.string().email(),
    socials: z.array(
      z.object({
        label: z.string(),
        url: z.string().url(),
      })
    ),
  }),
});

const portfolio = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    headline: z.string().optional(),
    year: z.number().int(),
    /** Optional release date (YYYY-MM-DD). Used for ordering when present;
     *  falls back to year-01-01 otherwise. Accepts YAML strings or dates. */
    date: z
      .union([z.string(), z.date()])
      .transform((d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10)))
      .optional(),
    client: z.string().optional(),
    thumbnail: z.string(),
    video_url: z.string().url(),
    extra_videos: z
      .array(
        z.object({
          url: z.string().url(),
          label: z.string().optional(),
        })
      )
      .default([]),
    description: z.string(),
    frames_label: z.string().optional(),
    frames_intro: z.string().optional(),
    role: z.string().optional(),
    category: z.enum(CATEGORIES).optional(),
    format: z.string().optional(),
    equipment: z.array(z.enum(EQUIPMENT)).default([]),
    tags: z.array(z.enum(TAGS)).default([]),
    stills: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
          caption: z.string().optional(),
        })
      )
      .default([]),
  }),
});

// One markdown entry per photo. Collection is inferred from the image path —
// when a photo lives in /uploads/photography/<collection>/, the page filters
// it under that collection. Photos in the root are "uncategorized" and don't
// appear in any filter chip's set.
const photography = defineCollection({
  type: 'content',
  schema: z.object({
    image: z.string(),
    alt: z.string(),
    title: z.string().optional(),
    caption: z.string().optional(),
    date: z
      .union([z.string(), z.date()])
      .transform((d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10)))
      .optional(),
    collection: z.enum(PHOTO_COLLECTIONS).optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    /** Override the mosaic preview aspect ratio (width/height). Useful when
     *  a landscape photo would otherwise dominate the grid; the lightbox
     *  always shows the uncropped original. */
    preview_aspect: z.number().optional(),
  }),
});

const travelJournal = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    location: z.string(),
    year: z.number().int(),
    /** Manual display order on the index. Lower = earlier. Entries without
     *  `order` fall to the end, then sort year-desc / alpha as a tiebreaker. */
    order: z.number().int().optional(),
    hero_image: z.string(),
    intro: z.string().optional(),
    body: z
      .array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('image'),
            src: z.string(),
            alt: z.string(),
            caption: z.string().optional(),
            // Optional Caveat-font label rendered above the image (same
            // styling as a section heading, but scoped to a single image).
            // Use for per-image timestamps like "12:16pm: a quick lunch".
            label: z.string().optional(),
            // Layout hint from the source row grouping: 'half' = side-by-side
            // pair, 'full' = full width. 'wide' + 'narrow' pair into a 2:1
            // row (use when one image should take more horizontal space than
            // its partner). Absent → fall back to auto rhythm.
            width: z.enum(['full', 'half', 'wide', 'narrow']).optional(),
            // Optional CSS grid-template-columns override for the pair row
            // this image starts. Use when the default 2fr:1fr isn't enough
            // (e.g. pairing a 9:16 portrait with a 3:2 landscape needs
            // something like '1fr 3fr'). Only honored on the first image of
            // a wide/narrow pair.
            cols: z.string().optional(),
          }),
          z.object({
            type: z.literal('text'),
            body: z.string(),
            // For a text+image pair: which side the text sits on. Default is
            // 'right' (image left, text right). 'left' flips it.
            align: z.enum(['left', 'right']).optional(),
          }),
        ])
      )
      .default([]),
  }),
});

export const collections = {
  site,
  portfolio,
  photography,
  'travel-journal': travelJournal,
};
