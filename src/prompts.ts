import { type EventRecord } from './schema';

export function buildClassificationPrompt(
  contentText: string,
  imageUrls: string[],
  opts?: { sourceDate?: string; sourceUrl?: string; sourceLabel?: string },
) {
  const metaParts: string[] = [];
  if (opts?.sourceLabel) metaParts.push(`Source: ${opts.sourceLabel}`);
  if (opts?.sourceUrl) metaParts.push(`Source URL: ${opts.sourceUrl}`);
  metaParts.push(
    opts?.sourceDate ? `Source date (UTC ISO): ${opts.sourceDate}` : 'Source date: unknown',
  );
  const meta = metaParts.join('\n');

  const system = `You are an expert event information extractor. Determine if the content announces an event. If it is an event, extract a clean JSON.`;
  const user = `
Task:
1) Decide if this is an anime / game / comic (nijigen) related event announcement ("isEvent": true/false). An event is defined as a scheduled public gathering, pop up shop, exhibition, convention, live show, collaboration cafe, or similar activity that fans can attend in person. Do not include online-only events.
2) Always fill "whyItIsEvent" with a concise reason for the decision. If false, respond with "isEvent": false, a concise "whyItIsEvent", and empty other optional fields.
3) Keep original language for title/description/location/organizer/price/tags.
4) Summarize title/description if needed.
5) Dates in ISO if possible (YYYY-MM-DD or full). If not sure, keep original text. Use the tweet date as a reference point for inferring missing year (e.g., "this Friday").
6) Include provided image URLs that show event info.
7) If some fields are unclear, read from images if possible.
8) Respond ONLY with minified JSON, no explanations.

Content:
${contentText}
${meta}
${imageUrls.length > 0 ? `Images: ${imageUrls.join(', ')}` : ''}`;
  return { system, user };
}

export function buildTranslationPrompt(eventJson: EventRecord) {
  const system = `You are a professional translator. Translate data to Chinese while preserving factual details.`;
  const user = `
Translate this event info JSON to Chinese for fields: title, description, location, organizer, price, tags. Keep other fields unchanged. Respond ONLY with JSON, same schema.

Event JSON:
${JSON.stringify(eventJson)}`;
  return { system, user };
}
