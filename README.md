# Event Tracker Bot

Telegram bot that collects event information from chat. It can process URLs (Twitter/X and other websites), Telegram text/captions, photos, and image documents. It uses OpenRouter to detect and extract event info, optionally translates into Chinese, and upserts the data into a Google Sheet.

## Setup

- Install deps

```bash
bun install
```

- Create .env
  Copy `.env.example` to `.env` and fill values:
  - TELEGRAM_BOT_TOKEN: from BotFather
  - OPENROUTER_API_KEY: from <https://openrouter.ai/keys>
  - OPENROUTER_GEMINI_MODEL: default `~google/gemini-flash-latest:nitro`
  - OPENROUTER_DEEPSEEK_MODEL: default `deepseek/deepseek-v4-pro:nitro`
  - GOOGLE_SERVICE_ACCOUNT_B64: base64 of service account JSON with Sheets scope
  - GOOGLE_SHEET_ID: target spreadsheet ID
  - GOOGLE_SHEET_NAME: target sheet name (default: Events)
  - GOOGLE_SHEET_CHINESE_NAME: tab name for translated entries (default: EventsInChinese)
  - TELEGRAM_HANDLER_TIMEOUT_MS: maximum time for one Telegram update handler (default: 300000)

- Google Sheet
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

Enable debug logs:

```bash
bun run index.ts --debug
```

Test pipeline for a single URL (without Telegram):

```bash
bun run src/pipeline.ts https://x.com/curtaindamashii/status/1975033367268872542

# Example (non-Twitter):
# bun run src/pipeline.ts https://example.com/some-event-page
```

## Notes

- In group chats, mention the bot in the message or caption to trigger extraction. Private chats are processed directly.
- When mentioning the bot in a reply, the original replied-to message text/caption/images are included as context.
- This project uses public endpoints (syndication/vxtwitter) to fetch tweet text/images; for private tweets it may fail.
- The LLM extraction is validated with Zod; if the output drifts, prompts may need tuning.
- The bot upserts rows by a source ID (Tweet ID for Twitter/X; a stable hash for other URLs; chat/message ID for Telegram messages).
