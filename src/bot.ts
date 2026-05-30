import { Telegraf, type Context } from 'telegraf';
import { CONFIG, assertConfig } from './config';
import { debug } from './debug';
import { processTelegramMessage, processUrl, type ProcessResult } from './pipeline';

const MAX_TELEGRAM_IMAGES = 4;
const TEMPORARY_REPLY_DELETE_MS = 60_000;
const TEMPORARY_REPLY_NOTICE = 'This message will be deleted in 1 min.';

type TelegramImageFile = {
  fileId: string;
  mimeType: string;
  sortValue: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMessageText(message: unknown): string | undefined {
  const record = asRecord(message);
  if (!record) return undefined;
  const maybeText = record.text;
  if (typeof maybeText === 'string') return maybeText;
  const maybeCaption = record.caption;
  if (typeof maybeCaption === 'string') return maybeCaption;
  return undefined;
}

function getMessageTextAndEntities(message: unknown): {
  text?: string;
  entities?: unknown;
} {
  const record = asRecord(message);
  if (!record) return {};

  if (typeof record.text === 'string') {
    return { text: record.text, entities: record.entities };
  }
  if (typeof record.caption === 'string') {
    return { text: record.caption, entities: record.caption_entities };
  }
  return {};
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

function extractFirstUrlFromText(text: string): string | undefined {
  // Match the first http(s) URL, trimming common trailing punctuation.
  // This intentionally supports *any* website, not just Twitter/X.
  const match = /https?:\/\/[^\s<>()]+/i.exec(text);
  if (!match) return undefined;

  let url = match[0];
  // Trim characters that commonly follow a URL in chat messages.
  url = url.replace(/[)\]}>.,!?;:'"“”’]+$/g, '');
  return url;
}

function getReplyMessage(message: unknown): unknown {
  return asRecord(message)?.reply_to_message;
}

function stripBotMention(text: string, botUsername?: string): string {
  const normalized = botUsername?.replace(/^@/, '').toLowerCase();
  if (!normalized) return text.trim();
  return text.replace(new RegExp(`@${escapeRegExp(normalized)}\\b`, 'gi'), '').trim();
}

function hasMeaningfulMessageText(message: unknown, botUsername?: string): boolean {
  const text = getMessageText(message);
  if (!text) return false;
  return stripBotMention(text, botUsername).length > 0;
}

function getTelegramImageFiles(message: unknown): TelegramImageFile[] {
  const record = asRecord(message);
  if (!record) return [];

  const files: TelegramImageFile[] = [];
  const photos = Array.isArray(record.photo) ? record.photo : [];
  let largestPhoto: TelegramImageFile | undefined;

  for (const photo of photos) {
    const photoRecord = asRecord(photo);
    if (!photoRecord) continue;
    const fileId = photoRecord.file_id;
    if (typeof fileId !== 'string') continue;

    const fileSize = typeof photoRecord.file_size === 'number' ? photoRecord.file_size : 0;
    const width = typeof photoRecord.width === 'number' ? photoRecord.width : 0;
    const height = typeof photoRecord.height === 'number' ? photoRecord.height : 0;
    const sortValue = fileSize || width * height;
    if (!largestPhoto || sortValue > largestPhoto.sortValue) {
      largestPhoto = { fileId, mimeType: 'image/jpeg', sortValue };
    }
  }

  if (largestPhoto) files.push(largestPhoto);

  const document = asRecord(record.document);
  const documentFileId = document?.file_id;
  const mimeType = document?.mime_type;
  if (typeof documentFileId === 'string' && typeof mimeType === 'string') {
    if (mimeType.toLowerCase().startsWith('image/')) {
      files.push({ fileId: documentFileId, mimeType, sortValue: 0 });
    }
  }

  return files;
}

function messageHasTelegramImage(message: unknown): boolean {
  return getTelegramImageFiles(message).length > 0;
}

async function downloadTelegramImageDataUrl(
  ctx: Context,
  file: TelegramImageFile,
): Promise<string> {
  const fileLink = await ctx.telegram.getFileLink(file.fileId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.httpTimeoutMs);

  try {
    const response = await fetch(fileLink, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Telegram image download failed: ${response.status} ${response.statusText}`);
    }

    const headerMimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
    const mimeType = headerMimeType?.startsWith('image/') ? headerMimeType : file.mimeType;
    const buffer = Buffer.from(await response.arrayBuffer());
    debug('bot.telegram.image', { bytes: buffer.byteLength, mimeType });
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectTelegramImageDataUrls(ctx: Context, messages: unknown[]): Promise<string[]> {
  const imageDataUrls: string[] = [];

  for (const message of messages) {
    for (const file of getTelegramImageFiles(message)) {
      if (imageDataUrls.length >= MAX_TELEGRAM_IMAGES) return imageDataUrls;
      imageDataUrls.push(await downloadTelegramImageDataUrl(ctx, file));
    }
  }

  return imageDataUrls;
}

function buildTelegramContentText(
  message: unknown,
  replied: unknown,
  botUsername?: string,
): string {
  const parts: string[] = [];
  const repliedText = getMessageText(replied);
  if (repliedText) {
    parts.push(`Original replied message:\n${repliedText.trim()}`);
  }

  const messageText = getMessageText(message);
  if (messageText) {
    const cleaned = stripBotMention(messageText, botUsername);
    if (cleaned) {
      const label = replied ? 'Mention message' : 'Telegram message';
      parts.push(`${label}:\n${cleaned}`);
    }
  }

  return parts.join('\n\n').trim();
}

function getChatId(chat: unknown): string {
  const id = asRecord(chat)?.id;
  if (typeof id === 'number' || typeof id === 'string') return String(id);
  return 'unknown';
}

function getMessageId(message: unknown): string {
  const id = asRecord(message)?.message_id;
  if (typeof id === 'number' || typeof id === 'string') return String(id);
  return 'unknown';
}

function makeTelegramSourceId(chat: unknown, message: unknown): string {
  return `telegram:${getChatId(chat)}:${getMessageId(message)}`;
}

function makeTelegramSourceUrl(chat: unknown, message: unknown): string {
  const chatRecord = asRecord(chat);
  const username = chatRecord?.username;
  const messageId = getMessageId(message);

  if (typeof username === 'string' && username.length > 0) {
    return `https://t.me/${username}/${messageId}`;
  }

  const chatId = getChatId(chat);
  if (chatId.startsWith('-100')) {
    return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  }

  return `https://t.me/private/${encodeURIComponent(chatId.replace(/^-/, ''))}/${messageId}`;
}

function formatTemporaryMessage(text: string): string {
  const trimmed = text.trim();
  const maxBodyLength = 3500 - TEMPORARY_REPLY_NOTICE.length - 2;
  const body =
    trimmed.length <= maxBodyLength ? trimmed : `${trimmed.slice(0, maxBodyLength - 3)}...`;
  return `${body}\n\n${TEMPORARY_REPLY_NOTICE}`;
}

async function replyTemporarily(ctx: Context, text: string): Promise<void> {
  const sent = await ctx.reply(formatTemporaryMessage(text), {
    link_preview_options: { is_disabled: true },
  });
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  setTimeout(() => {
    void ctx.telegram.deleteMessage(chatId, sent.message_id).catch((e) => {
      debug('bot.temporaryReply.delete.error', (e as Error).message);
    });
  }, TEMPORARY_REPLY_DELETE_MS);
}

function getRejectionReason(result: ProcessResult): string {
  const reason = result.extracted.whyItIsEvent?.trim();
  if (reason) return reason;
  return 'The message was not classified as an eligible in-person anime, game, comic, or related fan event.';
}

function getTelegramSourceDate(message: unknown): string | undefined {
  const date = asRecord(message)?.date;
  if (typeof date !== 'number') return undefined;
  return new Date(date * 1000).toISOString();
}

function getTelegramAuthor(message: unknown): { authorName?: string; authorHandle?: string } {
  const from = asRecord(asRecord(message)?.from);
  if (!from) return {};

  const firstName = typeof from.first_name === 'string' ? from.first_name : '';
  const lastName = typeof from.last_name === 'string' ? from.last_name : '';
  const username = typeof from.username === 'string' ? from.username : undefined;
  const authorName = [firstName, lastName].filter(Boolean).join(' ') || username;
  return {
    authorName,
    authorHandle: username ? `@${username}` : undefined,
  };
}

function chooseTelegramSourceMessage(
  message: unknown,
  replied: unknown,
  botUsername?: string,
): unknown {
  const repliedHasContent =
    messageHasTelegramImage(replied) || hasMeaningfulMessageText(replied, botUsername);
  const messageHasContent =
    messageHasTelegramImage(message) || hasMeaningfulMessageText(message, botUsername);

  if (replied && repliedHasContent && !messageHasContent) return replied;
  return message;
}

async function replyWithProcessResult(ctx: Context, result: ProcessResult): Promise<void> {
  if (!result.extracted.isEvent) {
    await replyTemporarily(ctx, `Event rejected: ${getRejectionReason(result)}`);
    return;
  }

  const title = result.translated?.title ?? result.extracted.title ?? '(no title)';
  const start = result.extracted.startDate ?? '(unknown)';
  const end = result.extracted.endDate ?? '';
  const when = end ? `${start} → ${end}` : start;
  const where = result.translated?.location ?? result.extracted.location ?? '(unknown)';
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.googleSheetId}/edit`;
  const textMsg = `Event: ${title}\nWhen: ${when}\nWhere: ${where}\nSheet: ${sheetUrl}`;
  await ctx.reply(textMsg, { link_preview_options: { is_disabled: true } });
}

export function startBot() {
  assertConfig();
  const bot = new Telegraf(CONFIG.telegramToken, {
    handlerTimeout: CONFIG.telegramHandlerTimeoutMs,
  });

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

  const handleTelegramMessage = async (ctx: Context) => {
    const message = ctx.message;
    if (!message) return;

    const chatType = (ctx.chat as { type?: unknown } | undefined)?.type;
    const isPrivateChat = chatType === 'private';
    const currentContent = getMessageTextAndEntities(message);

    // Only process in non-private chats when the bot is explicitly mentioned.
    if (!isPrivateChat) {
      const username = botUsername;
      if (!username) return; // if we can't resolve our username, fail closed in groups
      if (!currentContent.text) return;
      if (!messageMentionsBot(currentContent.text, currentContent.entities, username)) return;
    }

    // If this is a reply where the bot is mentioned, prefer the original message for URL extraction.
    const replied = getReplyMessage(message);
    const candidateTexts: string[] = [];
    const repliedText = getMessageText(replied);
    if (repliedText) candidateTexts.push(repliedText);
    const messageText = getMessageText(message);
    if (messageText) candidateTexts.push(messageText);

    const url = candidateTexts.map(extractFirstUrlFromText).find((u) => typeof u === 'string');
    const hasTelegramImages = messageHasTelegramImage(message) || messageHasTelegramImage(replied);
    const shouldProcessTelegramMessage = hasTelegramImages || !url;

    if (!shouldProcessTelegramMessage && !url) return;

    const contentText = buildTelegramContentText(message, replied, botUsername);
    if (shouldProcessTelegramMessage && !contentText && !hasTelegramImages) return;

    try {
      await ctx.sendChatAction('typing');

      const result = shouldProcessTelegramMessage
        ? await (async () => {
            const sourceMessage = chooseTelegramSourceMessage(message, replied, botUsername);
            const images = await collectTelegramImageDataUrls(ctx, [replied, message]);
            debug('bot.process.telegram', { images: images.length, textLen: contentText.length });
            return processTelegramMessage({
              text: contentText,
              images,
              sourceId: makeTelegramSourceId(ctx.chat, sourceMessage),
              url: makeTelegramSourceUrl(ctx.chat, sourceMessage),
              ...getTelegramAuthor(sourceMessage),
              sourceDate: getTelegramSourceDate(sourceMessage),
            });
          })()
        : await (async () => {
            debug('bot.process.url', { url });
            return processUrl(url);
          })();

      await replyWithProcessResult(ctx, result);
      debug('bot.process.success');
    } catch (e) {
      const msg = (e as Error).message;
      debug('bot.process.error', msg);
      await replyTemporarily(ctx, `Event adding failed: ${msg}`);
    }
  };

  bot.on('text', handleTelegramMessage);
  bot.on('photo', handleTelegramMessage);
  bot.on('document', handleTelegramMessage);

  void bot.launch();
  console.log('Telegram bot started.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
