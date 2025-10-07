import { Telegraf, type Context } from "telegraf";
import { CONFIG, assertConfig } from "./config";
import { processTweetUrl } from "./pipeline";
import { debug } from "./debug";

export function startBot() {
  assertConfig();
  const bot = new Telegraf(CONFIG.telegramToken);

  bot.on("text", async (ctx: Context) => {
    const message = ctx.message;
    if (!message || !("text" in message) || typeof message.text !== "string")
      return;
    const text = message.text;
    const urlMatch = text.match(
      /https?:\/\/(?:x|twitter)\.com\/[\w_]+\/status\/\d+/i
    );
    if (!urlMatch) return; // ignore non-tweet messages

    const url = urlMatch[0];
    await ctx.reply(`Processing tweet: ${url}`);
    debug("bot.process", { url });
    try {
      const result = await processTweetUrl(url);
      const status = `${result.sheets.action.toUpperCase()} row ${
        result.sheets.row
      }`;
      await ctx.reply(
        `Event: ${result.extracted.title ?? "(no title)"}\nAction: ${status}`
      );
      if (result.chineseSheets) {
        debug("bot.process.cn", result.chineseSheets);
      }
    } catch (e) {
      const msg = (e as Error).message;
      debug("bot.process.error", msg);
      await ctx.reply(`Failed: ${msg}`);
    }
  });

  bot.launch();
  console.log("Telegram bot started.");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
