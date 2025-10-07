import { CONFIG, assertConfig } from './config';
import { debug, setDebug } from './debug';
import { chat } from './openrouter';
import { buildClassificationPrompt, buildTranslationPrompt } from './prompts';
import { EventSchema, type EventRecord } from './schema';
import { createSheetsClient } from './sheets';
import { fetchTweet } from './twitter';

export async function processTweetUrl(url: string) {
  const tweet = await fetchTweet(url);
  if (!tweet) throw new Error('Unable to fetch tweet');

  // Build messages for Gemini (can include images as tool content references)
  debug('pipeline.tweet', {
    id: tweet.id,
    images: tweet.images.length,
    textLen: tweet.text.length,
  });
  const { system, user } = buildClassificationPrompt(tweet.text, tweet.images);
  const messages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: user },
        ...tweet.images.map((u) => ({
          type: 'image_url' as const,
          image_url: { url: u },
        })),
      ],
    },
  ];

  const extractionStr = await chat(messages, {
    model: CONFIG.geminiModel,
    response_format: { type: 'json_object' },
  });
  debug('pipeline.extractionRawLen', extractionStr.length);
  let extracted: EventRecord;
  try {
    const parsed = JSON.parse(extractionStr) as EventRecord;
    // Fill source fields
    if (!parsed.source)
      parsed.source = {
        platform: 'twitter',
        url: tweet.url,
        tweetId: tweet.id,
        authorName: tweet.authorName,
        authorHandle: tweet.authorScreenName,
      };
    parsed.source.platform = 'twitter';
    parsed.source.url = tweet.url;
    parsed.source.tweetId = tweet.id;
    parsed.source.authorName = tweet.authorName;
    parsed.source.authorHandle = tweet.authorScreenName;
    parsed.images = parsed.images ?? tweet.images ?? [];
    extracted = EventSchema.parse(parsed);
  } catch (e) {
    debug('pipeline.extractionParseError', (e as Error).message);
    throw new Error(
      'Failed to parse or validate extraction: ' + (e as Error).message + '\nRaw: ' + extractionStr,
    );
  }

  // If not an event, return early
  if (!extracted.isEvent) {
    return {
      extracted,
      translated: undefined,
      sheets: { action: 'skipped', row: -1 },
    };
  }

  // Translate to Chinese when original isn't Chinese
  let translated: EventRecord | undefined = undefined;
  const { system: tSys, user: tUser } = buildTranslationPrompt(extracted);
  const tMsg = [
    { role: 'system' as const, content: tSys },
    { role: 'user' as const, content: tUser },
  ];
  const tStr = await chat(tMsg, {
    model: CONFIG.deepseekModel,
    response_format: { type: 'json_object' },
  });
  try {
    const tParsed = JSON.parse(tStr) as EventRecord;
    translated = EventSchema.parse(tParsed);
  } catch {
    // ignore translation errors
    debug('pipeline.translationParseError');
  }

  // Upsert into Google Sheet
  const sheets = await createSheetsClient(CONFIG.googleSheetId, CONFIG.googleSheetName);
  const result = await sheets.upsertEvent(extracted);
  debug('pipeline.sheets', result);
  let cnResult: { action: string; row: number } | undefined;
  if (translated) {
    try {
      const client = await createSheetsClient(CONFIG.googleSheetId, CONFIG.googleSheetChineseName);
      cnResult = await client.upsertEvent(translated);
      debug('pipeline.sheets.cn', cnResult);
    } catch (e) {
      // do not fail the whole pipeline if Chinese upsert fails
      cnResult = undefined;
      debug('pipeline.sheets.cn.error', (e as Error).message);
    }
  }

  return { extracted, translated, sheets: result, chineseSheets: cnResult };
}

// Optional dev entry when run directly
if (import.meta.main) {
  setDebug(true);
  assertConfig();
  const url = process.argv[2] ?? '';
  if (!url) {
    console.error('Usage: bun run src/pipeline.ts <tweetUrl>');
    process.exit(1);
  }
  processTweetUrl(url)
    .then((r) => {
      console.log('Extraction:', r.extracted);
      if (r.translated) console.log('Chinese:', r.translated);
      console.log('Sheets:', r.sheets);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
