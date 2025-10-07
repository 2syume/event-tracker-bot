# Event Tracker Bot

Telegram bot that collects Twitter/X links from chat, fetches tweet content (text + images), uses Gemini 2.5 Flash via OpenRouter to detect and extract event info, optionally translates into Chinese using DeepSeek v3.1 (OpenRouter), and upserts the data into a Google Sheet.

## Setup

1. Install deps

```bash
bun install
```

2. Create .env
   Copy `.env.example` to `.env` and fill values:

- TELEGRAM_BOT_TOKEN: from BotFather
- OPENROUTER_API_KEY: from https://openrouter.ai/keys
- OPENROUTER_GEMINI_MODEL: default `google/gemini-2.5-flash`
- OPENROUTER_DEEPSEEK_MODEL: default `deepseek/deepseek-chat-v3.1`
- GOOGLE_SERVICE_ACCOUNT_B64: base64 of service account JSON with Sheets scope
- GOOGLE_SHEET_ID: target spreadsheet ID
- GOOGLE_SHEET_NAME: target sheet name (default: Events)

Optional:

- JINA_READER_API_KEY: to improve tweet fallback extraction
- HTTP_TIMEOUT_MS

3. Google Sheet

- Share the sheet with your service account email.
- First run will create headers automatically.

## Run

Start the Telegram bot:

```bash
bun run index.ts
```

Dev hot reload:

```bash
bun run --hot index.ts
```

Test pipeline for a single tweet (without Telegram):

```bash
bun run src/pipeline.ts https://twitter.com/someuser/status/1234567890
```

## Notes

- This project uses public endpoints (syndication/vxtwitter) to fetch tweet text/images; for private tweets it may fail.
- The LLM extraction is validated with Zod; if the output drifts, prompts may need tuning.
- The bot upserts rows by Tweet ID.
