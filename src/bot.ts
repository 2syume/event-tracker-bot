import { Telegraf, type Context } from 'telegraf';
import { CONFIG, assertConfig } from './config';
import { debug } from './debug';
import { processTweetUrl } from './pipeline';

export function startBot() {
  assertConfig();
  const bot = new Telegraf(CONFIG.telegramToken);

  bot.on('text', async (ctx: Context) => {
    const message = ctx.message;
    if (!message || !('text' in message) || typeof message.text !== 'string') return;
    const text = message.text;
    const urlMatch = /https?:\/\/(?:x|twitter)\.com\/[\w_]+\/status\/\d+/i.exec(text);
    if (!urlMatch) return; // ignore non-tweet messages

    const url = urlMatch[0];
    debug('bot.process', { url });
    try {
      await ctx.sendChatAction('typing');
      const result = await processTweetUrl(url);
      const title = result.translated?.title ?? result.extracted.title ?? '(no title)';
      const start = result.extracted.startDate ?? '(unknown)';
      const end = result.extracted.endDate ?? '';
      const when = end ? `${start} → ${end}` : start;
      const where = result.translated?.location ?? result.extracted.location ?? '(unknown)';
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}/edit`;
      const textMsg = `Event: ${title}\nWhen: ${when}\nWhere: ${where}\nSheet: ${sheetUrl}`;
      await ctx.reply(textMsg, { link_preview_options: { is_disabled: true } });
      debug('bot.process.success');
    } catch (e) {
      const msg = (e as Error).message;
      debug('bot.process.error', msg);
      await ctx.reply(`Failed: ${msg}`);
    }
  });

  void bot.launch();
  console.log('Telegram bot started.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
