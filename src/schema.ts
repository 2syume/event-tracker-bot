import { z } from 'zod';

type SerializedStringNode = {
  completionState?: unknown;
  type: 'String';
  value: string;
};

type SerializedObjectNode = {
  completionState?: unknown;
  entries?: unknown;
  type?: unknown;
};

function isSerializedStringNode(value: unknown): value is SerializedStringNode {
  if (!value || typeof value !== 'object') return false;

  const node = value as SerializedStringNode;
  return node.type === 'String' && typeof node.value === 'string';
}

function readSerializedObjectLocation(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const node = value as SerializedObjectNode;
  if (node.type !== 'Object') return undefined;
  if (!Array.isArray(node.entries)) return undefined;

  const values = new Map<string, string>();
  for (const entry of node.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
    if (!isSerializedStringNode(entry[1])) continue;

    const text = entry[1].value.trim();
    if (text) values.set(entry[0], text);
  }

  const location = [values.get('name'), values.get('address')].filter((part): part is string =>
    Boolean(part),
  );
  return location.length > 0 ? location.join(', ') : undefined;
}

export function normalizeLocation(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const location = value.trim();
  if (!location) return undefined;
  if (!location.startsWith('{')) return location;

  try {
    const parsed: unknown = JSON.parse(location);
    const normalized = readSerializedObjectLocation(parsed);
    if (normalized) return normalized;

    const maybeSerializedObject = parsed as SerializedObjectNode;
    if (maybeSerializedObject?.type === 'Object') {
      return undefined;
    }
  } catch {
    // A normal human-readable location may contain a leading brace.
  }

  return location;
}

export function normalizeEventRecord(event: EventRecord): EventRecord {
  return {
    ...event,
    location: normalizeLocation(event.location),
  };
}

export const EventSchema = z.object({
  source: z.object({
    platform: z.enum(['twitter', 'web', 'telegram']),
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
  location: z
    .string()
    .meta({
      description:
        'A single plain human-readable place name and/or street address. Never return JSON, serialized objects, tool output, completion metadata, or debug text.',
    })
    .optional(),
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
