export const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  openRouterKey: process.env.OPENROUTER_API_KEY ?? "",
  geminiModel: process.env.OPENROUTER_GEMINI_MODEL ?? "google/gemini-2.5-flash",
  deepseekModel:
    process.env.OPENROUTER_DEEPSEEK_MODEL ?? "deepseek/deepseek-chat-v3.1",
  googleServiceAccountB64: process.env.GOOGLE_SERVICE_ACCOUNT_B64 ?? "",
  googleSheetId: process.env.GOOGLE_SHEET_ID ?? "",
  googleSheetName: process.env.GOOGLE_SHEET_NAME ?? "Events",
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 20000),
} as const;

export function assertConfig() {
  const missing: string[] = [];
  if (!CONFIG.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!CONFIG.openRouterKey) missing.push("OPENROUTER_API_KEY");
  if (!CONFIG.googleServiceAccountB64)
    missing.push("GOOGLE_SERVICE_ACCOUNT_B64");
  if (!CONFIG.googleSheetId) missing.push("GOOGLE_SHEET_ID");
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(
        ", "
      )}. Please set them or create a .env file.`
    );
  }
}
