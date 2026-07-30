import z from 'zod';
import { CONFIG, assertConfig } from './config';
import { debug, setDebug } from './debug';
import { chat } from './openrouter';
import { buildClassificationPrompt, buildTranslationPrompt } from './prompts';
import { EventSchema, normalizeEventRecord, type EventRecord } from './schema';
import { createSheetsClient } from './sheets';
import { extractTweetId, fetchTweet } from './twitter';

import { createHash } from 'node:crypto';

export type ProcessSheetsResult =
  | { action: 'inserted' | 'updated'; row: number }
  | { action: 'skipped'; row: number };

export type ProcessResult = {
  extracted: EventRecord;
  translated?: EventRecord;
  sheets: ProcessSheetsResult;
  chineseSheets?: { action: string; row: number };
};

type SourcePlatform = 'twitter' | 'web' | 'telegram';

function makeWebSourceId(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `web:${hash}`;
}

async function processContent(opts: {
  platform: SourcePlatform;
  url: string;
  sourceId: string;
  text: string;
  images: string[];
  exposedImages?: string[];
  authorName?: string;
  authorHandle?: string;
  sourceDate?: string;
  sourceLabel?: string;
  fetchSourceUrl?: boolean;
}): Promise<ProcessResult> {
  const promptImageUrls = opts.exposedImages ?? opts.images;

  debug('pipeline.source', {
    platform: opts.platform,
    sourceId: opts.sourceId,
    images: opts.images.length,
    textLen: opts.text.length,
  });

  const { system, user } = buildClassificationPrompt(opts.text, promptImageUrls, {
    sourceDate: opts.sourceDate,
    sourceUrl: opts.url,
    sourceLabel: opts.sourceLabel,
    fetchSourceUrl: opts.fetchSourceUrl,
  });
  const messages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: user },
        ...opts.images.map((u) => ({
          type: 'image_url' as const,
          imageUrl: { url: u },
        })),
      ],
    },
  ];

  const extractionStr = await chat(messages, {
    model: CONFIG.geminiModel,
    temperature: 0,
    enableWebTools: opts.fetchSourceUrl === true,
    enforcedJsonSchema: {
      name: 'EventRecord',
      description: 'Extract event data from a webpage, social post, or chat message',
      schema: z.toJSONSchema(EventSchema),
    },
  });
  debug('pipeline.extractionRawLen', extractionStr.length);

  let extracted: EventRecord;
  try {
    const parsed = JSON.parse(extractionStr) as EventRecord;

    if (!parsed.source) {
      parsed.source = {
        platform: opts.platform,
        url: opts.url,
        tweetId: opts.sourceId,
        authorName: opts.authorName,
        authorHandle: opts.authorHandle,
      };
    }

    parsed.source.platform = opts.platform;
    parsed.source.url = opts.url;
    parsed.source.tweetId = opts.sourceId;
    if (opts.authorName) parsed.source.authorName = opts.authorName;
    if (opts.authorHandle) parsed.source.authorHandle = opts.authorHandle;
    const fallbackImages = (opts.exposedImages ?? opts.images).filter(
      (image) => !image.startsWith('data:'),
    );
    const parsedImages = Array.isArray(parsed.images)
      ? parsed.images.filter((image) => typeof image === 'string' && !image.startsWith('data:'))
      : [];
    parsed.images = parsedImages.length > 0 ? parsedImages : fallbackImages;

    extracted = normalizeEventRecord(EventSchema.parse(parsed));
  } catch (e) {
    debug('pipeline.extractionParseError', (e as Error).message);
    throw new Error(
      'Failed to parse or validate extraction: ' + (e as Error).message + '\nRaw: ' + extractionStr,
    );
  }

  if (!extracted.isEvent) {
    return {
      extracted,
      translated: undefined,
      sheets: { action: 'skipped', row: -1 },
    };
  }

  let translated: EventRecord | undefined = undefined;
  const { system: tSys, user: tUser } = buildTranslationPrompt(extracted);
  const tMsg = [
    { role: 'system' as const, content: tSys },
    { role: 'user' as const, content: tUser },
  ];
  const tStr = await chat(tMsg, {
    model: CONFIG.deepseekModel,
    temperature: 0.1,
    enforcedJsonSchema: {
      name: 'EventRecord',
      description: 'Translate event data',
      schema: z.toJSONSchema(EventSchema),
    },
  });
  try {
    const tParsed = JSON.parse(tStr) as EventRecord;
    translated = normalizeEventRecord(EventSchema.parse(tParsed));
  } catch {
    debug('pipeline.translationParseError');
  }

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
      cnResult = undefined;
      debug('pipeline.sheets.cn.error', (e as Error).message);
    }
  }

  return { extracted, translated, sheets: result, chineseSheets: cnResult };
}

export async function processTweetUrl(url: string) {
  // Backwards-compatible wrapper.
  return processUrl(url);
}

export async function processTelegramMessage(opts: {
  text: string;
  images: string[];
  sourceId: string;
  url: string;
  authorName?: string;
  authorHandle?: string;
  sourceDate?: string;
}): Promise<ProcessResult> {
  const text =
    opts.text.trim() ||
    '(No Telegram message text. Extract event details from the attached images.)';

  return processContent({
    platform: 'telegram',
    url: opts.url,
    sourceId: opts.sourceId,
    text,
    images: opts.images,
    exposedImages: [],
    authorName: opts.authorName,
    authorHandle: opts.authorHandle,
    sourceDate: opts.sourceDate,
    sourceLabel: 'Telegram',
  });
}

export async function processUrl(url: string): Promise<ProcessResult> {
  const tweetId = extractTweetId(url);
  if (tweetId) {
    const tweet = await fetchTweet(url);
    if (!tweet) throw new Error('Unable to fetch tweet');
    return processContent({
      platform: 'twitter',
      url: tweet.url,
      sourceId: tweet.id,
      text: tweet.text,
      images: tweet.images,
      authorName: tweet.authorName,
      authorHandle: tweet.authorScreenName,
      sourceDate: tweet.createdAt,
      sourceLabel: 'Twitter/X',
    });
  }

  return processContent({
    platform: 'web',
    url,
    sourceId: makeWebSourceId(url),
    text: '',
    images: [],
    sourceLabel: 'Web page',
    fetchSourceUrl: true,
  });
}

// Optional dev entry when run directly
if (import.meta.main) {
  setDebug(true);
  assertConfig();
  const url = process.argv[2] ?? '';
  if (!url) {
    console.error('Usage: bun run src/pipeline.ts <url>');
    process.exit(1);
  }
  processUrl(url)
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
