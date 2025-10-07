import { fetchTweet } from "./twitter";
import { chat } from "./openrouter";
import { buildClassificationPrompt, buildTranslationPrompt } from "./prompts";
import { EventSchema, type EventRecord } from "./schema";
import { createSheetsClient } from "./sheets";
import { CONFIG, assertConfig } from "./config";

export async function processTweetUrl(url: string) {
  const tweet = await fetchTweet(url);
  if (!tweet) throw new Error("Unable to fetch tweet");

  // Build messages for Gemini (can include images as tool content references)
  const { system, user } = buildClassificationPrompt(tweet.text, tweet.images);
  const messages = [
    { role: "system" as const, content: system },
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: user },
        ...tweet.images.map((u) => ({
          type: "image_url" as const,
          image_url: { url: u },
        })),
      ],
    },
  ];

  const extractionStr = await chat(messages, {
    model: CONFIG.geminiModel,
    response_format: { type: "json_object" },
  });
  let extracted: EventRecord;
  try {
    const parsed = JSON.parse(extractionStr);
    // Fill source fields
    if (!parsed.source) parsed.source = {} as any;
    parsed.source.platform = "twitter";
    parsed.source.url = tweet.url;
    parsed.source.tweetId = tweet.id;
    parsed.source.authorName = tweet.authorName;
    parsed.source.authorHandle = tweet.authorScreenName;
    parsed.images = parsed.images ?? tweet.images ?? [];
    extracted = EventSchema.parse(parsed);
  } catch (e) {
    throw new Error(
      "Failed to parse or validate extraction: " +
        (e as Error).message +
        "\nRaw: " +
        extractionStr
    );
  }

  // If not an event, return early
  if (!extracted.isEvent) {
    return {
      extracted,
      translated: undefined,
      sheets: { action: "skipped", row: -1 } as any,
    };
  }

  // Translate to Chinese when original isn't Chinese
  let translated: EventRecord | undefined = undefined;
  const isChinese =
    /[\u4e00-\u9fff]/.test(extracted.title ?? "") ||
    /[\u4e00-\u9fff]/.test(extracted.description ?? "");
  if (!isChinese) {
    const { system: tSys, user: tUser } = buildTranslationPrompt(extracted);
    const tMsg = [
      { role: "system" as const, content: tSys },
      { role: "user" as const, content: tUser },
    ];
    const tStr = await chat(tMsg, {
      model: CONFIG.deepseekModel,
      response_format: { type: "json_object" },
    });
    try {
      const tParsed = JSON.parse(tStr);
      translated = EventSchema.parse(tParsed);
    } catch {
      // ignore translation errors
    }
  }

  // Upsert into Google Sheet
  const sheets = await createSheetsClient(
    CONFIG.googleSheetId,
    CONFIG.googleSheetName
  );
  const result = await sheets.upsertEvent(extracted);

  return { extracted, translated, sheets: result };
}

// Optional dev entry when run directly
if (import.meta.main) {
  assertConfig();
  const url = process.argv[2] ?? "";
  if (!url) {
    console.error("Usage: bun run src/pipeline.ts <tweetUrl>");
    process.exit(1);
  }
  processTweetUrl(url)
    .then((r) => {
      console.log("Extraction:", r.extracted);
      if (r.translated) console.log("Chinese:", r.translated);
      console.log("Sheets:", r.sheets);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
