import { z } from 'zod';

export const EventSchema = z.object({
  source: z.object({
    platform: z.enum(['twitter', 'web']),
    url: z.url(),
    tweetId: z.string(),
    authorName: z.string().optional(),
    authorHandle: z.string().optional(),
  }),
  isEvent: z.boolean(),
  whyItIsEvent: z.string().optional(),
  locale: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().optional(), // ISO or natural language
  endDate: z.string().optional(),
  registrationUrl: z.url().optional(),
  location: z.string().optional(),
  images: z.array(z.url()).default([]),
  // Extra structured fields
  organizer: z.string().optional(),
  price: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type EventRecord = z.infer<typeof EventSchema>;

export const TranslatedEventSchema = z.object({
  original: EventSchema,
  chinese: EventSchema.optional(),
});

export type TranslatedEventRecord = z.infer<typeof TranslatedEventSchema>;
