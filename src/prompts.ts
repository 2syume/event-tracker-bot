import { type EventRecord } from './schema';

export function buildClassificationPrompt(
  tweetText: string,
  imageUrls: string[],
  opts?: { tweetDate?: string },
) {
  const system = `You are an expert event information extractor. Determine if the content announces a real event. If it is an event, extract a clean JSON.`;
  const schemaText = `{
  "source": {
    "platform": "twitter",
    "url": string,
    "tweetId": string,
    "authorName"?: string,
    "authorHandle"?: string
  },
  "isEvent": boolean,
  "locale"?: string,
  "title"?: string,
  "description"?: string,
  "startDate"?: string,
  "endDate"?: string,
  "registrationUrl"?: string,
  "location"?: string,
  "images": string[],
  "organizer"?: string,
  "price"?: string,
  "tags"?: string[]
}`;
  const meta = opts?.tweetDate ? `Tweet date (UTC ISO): ${opts.tweetDate}` : 'Tweet date: unknown';
  const user = `Content:
${tweetText}
Images: ${imageUrls.join(', ') || 'none'}
${meta}

Task:
1) Decide if this is an event announcement (isEvent=true/false).
2) If true, fill the JSON schema below.
3) Keep original language for title/description/location/organizer/price/tags.
4) Summarize title/description if needed.
5) Dates in ISO if possible (YYYY-MM-DD or full). If not sure, keep original text. Use the tweet date as a reference point for inferring missing year (e.g., "this Friday").
6) Include provided image URLs that show event info.
7) If some fields are unclear, read from images if possible.
8) Respond ONLY with minified JSON, no explanations.
Schema:
${schemaText}`;
  return { system, user };
}

export function buildTranslationPrompt(eventJson: EventRecord) {
  const system = `You translate event data to Chinese while preserving factual details.`;
  const user = `Translate this event JSON to Chinese for fields: title, description, location, organizer, price, tags. Keep other fields unchanged. Respond ONLY with JSON, same schema.
Event:
${JSON.stringify(eventJson)}`;
  return { system, user };
}
