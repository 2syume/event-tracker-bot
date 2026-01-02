import { Telegraf, type Context } from 'telegraf';
import { CONFIG, assertConfig } from './config';
import { debug } from './debug';
import { processTweetUrl } from './pipeline';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const maybeText = (message as { text?: unknown }).text;
  if (typeof maybeText === 'string') return maybeText;
  const maybeCaption = (message as { caption?: unknown }).caption;
  if (typeof maybeCaption === 'string') return maybeCaption;
  return undefined;
}

function messageMentionsBot(
  messageText: string,
  messageEntities: unknown,
  botUsername: string,
): boolean {
  const normalized = botUsername.replace(/^@/, '').toLowerCase();
  if (!normalized) return false;

  const entities = Array.isArray(messageEntities) ? messageEntities : undefined;
  if (entities?.length) {
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue;
      const entityType = (entity as { type?: unknown }).type;
      if (entityType !== 'mention') continue;
      const offset = (entity as { offset?: unknown }).offset;
      const length = (entity as { length?: unknown }).length;
      if (typeof offset !== 'number' || typeof length !== 'number') continue;
      const mentionText = messageText.slice(offset, offset + length);
      if (mentionText.toLowerCase() === `@${normalized}`) return true;
    }
  }

  return new RegExp(`@${escapeRegExp(normalized)}\\b`, 'i').test(messageText);
}

function extractTweetUrlFromText(text: string): string | undefined {
  // Match X/Twitter URLs from official and popular mirror/fix domains
  // Supports: x.com, twitter.com, mobile.twitter.com, vxtwitter.com, fxtwitter.com, fixupx.com, fixvx.com, pxtwitter.com, twittpr.com
  // Path variants: /<user>/status/<id>, /i/status/<id>, /i/web/status/<id>
  const urlMatch =
    /https?:\/\/(?:(?:x|twitter|mobile\.twitter|vxtwitter|fxtwitter|fixupx|fixvx|pxtwitter|twittpr)\.com)\/(?:[\w_]+|i(?:\/web)?)\/status\/\d+/i.exec(
      text,
    );
  if (!urlMatch) return undefined;

  // Normalize to canonical x.com URL to keep logs/results consistent
  return urlMatch[0]
    .replace(
      /^(https?:\/\/)(?:twitter|mobile\.twitter|vxtwitter|fxtwitter|fixupx|fixvx|pxtwitter|twittpr)\.com/i,
      '$1x.com',
    )
    .replace(/\/(?:i(?:\/web)?)\/status\//i, '/i/status/');
}

export function startBot() {
  assertConfig();
  const bot = new Telegraf(CONFIG.telegramToken);

  // Cache bot username for mention detection in group chats.
  let botUsername: string | undefined;
  void bot.telegram
    .getMe()
    .then((me) => {
      botUsername = me.username ? me.username.toLowerCase() : undefined;
      debug('bot.info', { username: botUsername });
    })
    .catch((e) => {
      debug('bot.info.error', (e as Error).message);
    });

  bot.on('text', async (ctx: Context) => {
    const message = ctx.message;
    if (!message || !('text' in message) || typeof message.text !== 'string') return;

    const chatType = (ctx.chat as { type?: unknown } | undefined)?.type;
    const isPrivateChat = chatType === 'private';

    // Only process in non-private chats when the bot is explicitly mentioned.
    if (!isPrivateChat) {
      const username = botUsername;
      if (!username) return; // if we can't resolve our username, fail closed in groups
      const entities = (message as { entities?: unknown }).entities;
      if (!messageMentionsBot(message.text, entities, username)) return;
    }

    // If this is a reply where the bot is mentioned, prefer the original message for URL extraction.
    const replied = (message as { reply_to_message?: unknown }).reply_to_message;
    const candidateTexts: string[] = [];
    const repliedText = getMessageText(replied);
    if (repliedText) candidateTexts.push(repliedText);
    candidateTexts.push(message.text);

    const url = candidateTexts.map(extractTweetUrlFromText).find((u) => typeof u === 'string');
    if (!url) return; // ignore non-tweet messages

    debug('bot.process', { url });
    try {
      await ctx.sendChatAction('typing');
      const result = await processTweetUrl(url);
      if (!result.extracted.isEvent) return;

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
