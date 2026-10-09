/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Utilities to parse Twitter/X URLs and fetch tweet content (text + images)
// We avoid Twitter API by using public FxTwitter/VxTwitter APIs and webpage/CDN fallbacks.
import { debug } from './debug';

export type TweetMedia = {
  type: 'photo' | 'video' | 'animated_gif' | 'unknown';
  url: string; // direct image/video url when possible
};

export type TweetData = {
  id: string;
  url: string;
  text: string;
  authorName?: string;
  authorScreenName?: string;
  images: string[];
  lang?: string;
  // ISO 8601 timestamp when available (tweet creation time)
  createdAt?: string;
};

// Match canonical and mirror/fix domains for X/Twitter plus common path variants
// Examples:
// - https://x.com/user/status/123
// - https://twitter.com/user/status/123
// - https://mobile.twitter.com/user/status/123
// - https://vxtwitter.com/i/web/status/123
// - https://fxtwitter.com/i/status/123
// - https://fixupx.com/user/status/123
const TWITTER_URL_RE =
  /https?:\/\/(?:(?:x|twitter|mobile\.twitter|vxtwitter|fxtwitter|fixupx|fixvx|pxtwitter|twittpr)\.com)\/(?:[^\s/]+|i(?:\/web)?)\/status\/(\d+)/i;

export function extractTweetId(input: string): string | null {
  const m = TWITTER_URL_RE.exec(input);
  return m?.[1] ?? null;
}

async function fetchText(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.HTTP_TIMEOUT_MS ?? 20000),
  );
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...(init?.headers ?? {}), 'User-Agent': 'Mozilla/5.0' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaFxTwitter(id: string): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(`https://api.fxtwitter.com/status/${id}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.code !== 200 || data.tweet?.id !== id) return null;
    const tweet = data.tweet;
    const text: string = typeof tweet.text === 'string' ? tweet.text : '';
    const images: string[] = (Array.isArray(tweet.media?.photos) ? tweet.media.photos : [])
      .map((photo: any) => photo?.url)
      .filter((url: unknown): url is string => typeof url === 'string' && url.length > 0);
    const createdRaw: unknown = tweet.created_at;
    const createdDate = typeof createdRaw === 'string' ? new Date(createdRaw) : undefined;
    const createdAt =
      createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate.toISOString() : undefined;
    const result = {
      text,
      images,
      authorName: tweet.author?.name as string | undefined,
      authorScreenName: tweet.author?.screen_name as string | undefined,
      lang: tweet.lang as string | undefined,
      createdAt,
    };
    debug('fetchViaFxTwitter ok', { id, textLen: text.length, images: images.length });
    return result;
  } catch {
    return null;
  }
}

// Syndication CDN (works for many public tweets)
async function fetchViaSyndication(id: string): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en`);
    if (!res.ok) return null;
    const data: any = await res.json();
    // Known fields: text, user.name, user.screen_name, entities.media
    const text: string = data.text ?? '';
    const authorName: string | undefined = data.user?.name;
    const authorScreenName: string | undefined = data.user?.screen_name;
    const images: string[] = (data.entities?.media ?? [])
      .filter((m: any) => m.type === 'photo' && m.media_url_https)
      .map((m: any) => m.media_url_https);
    // created_at example: "Thu Oct 24 12:34:56 +0000 2024"
    const createdRaw: string | undefined = data.created_at ?? data.createdAt;
    const createdAt = createdRaw ? new Date(createdRaw).toISOString() : undefined;
    const result = { text, authorName, authorScreenName, images, createdAt };
    debug('fetchViaSyndication ok', {
      id,
      textLen: text.length,
      images: images.length,
    });
    return result;
  } catch {
    return null;
  }
}

// VxTwitter provides enriched metadata for public tweets
async function fetchViaVxTwitter(id: string): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(`https://api.vxtwitter.com/Twitter/status/${id}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data.text ?? data.tweet?.text ?? '';
    const authorName: string | undefined = data.user_name ?? data.user?.name;
    const authorScreenName: string | undefined = data.user_screen_name ?? data.user?.screen_name;
    const images: string[] = (data.media_extended ?? data.media?.photos ?? [])
      .filter((m: any) => m?.type === 'image')
      .map((m: any) => m.url ?? m.src)
      .filter(Boolean);
    // timestamp fields could be "date" (ISO) or nested tweet.created_at
    const createdRaw: string | number | undefined =
      data.date_epoch ?? data.date ?? data.created_at ?? data.createdAt ?? data.tweet?.created_at;
    let createdAt: string | undefined;
    if (typeof createdRaw === 'number') {
      // seconds or milliseconds
      const ms = createdRaw < 1e12 ? createdRaw * 1000 : createdRaw;
      createdAt = new Date(ms).toISOString();
    } else if (typeof createdRaw === 'string') {
      const d = new Date(createdRaw);
      if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
    }
    const result = { text, authorName, authorScreenName, images, createdAt };
    debug('fetchViaVxTwitter ok', {
      id,
      textLen: text.length,
      images: images.length,
    });
    return result;
  } catch {
    return null;
  }
}

// Jina AI Reader API for webpage content extraction as fallback (no key required)
async function fetchViaJina(url: string): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText('https://r.jina.ai/http://' + url.replace(/^https?:\/\//, ''));
    if (!res.ok) return null;
    const text = await res.text();
    debug('fetchViaJina ok', { url, textLen: text.length });
    return { text, images: [] };
  } catch {
    return null;
  }
}

export async function fetchTweet(url: string): Promise<TweetData | null> {
  // Normalize various mirror domains to x.com for consistency
  const normalizedUrl = url
    .replace(
      /^(https?:\/\/)(?:twitter|mobile\.twitter|vxtwitter|fxtwitter|fixupx|fixvx|pxtwitter|twittpr)\.com/i,
      '$1x.com',
    )
    .replace(/\/(?:i(?:\/web)?)\/status\//i, '/i/status/');
  const id = extractTweetId(normalizedUrl);
  if (!id) return null;

  const base: TweetData = { id, url: normalizedUrl, text: '', images: [] };
  debug('fetchTweet start', { id, url: normalizedUrl });
  const viaFx = await fetchViaFxTwitter(id);
  if (viaFx?.text || viaFx?.images?.length) {
    debug('fetchTweet using fxtwitter', { id });
    return { ...base, ...viaFx } satisfies TweetData;
  }
  const viaVx = await fetchViaVxTwitter(id);
  if (viaVx?.text || viaVx?.images?.length) {
    debug('fetchTweet using vxtwitter', { id });
    return { ...base, ...viaVx } satisfies TweetData;
  }
  const viaJina = await fetchViaJina(normalizedUrl);
  if (viaJina?.text) {
    debug('fetchTweet using jina', { id });
    return { ...base, ...viaJina } satisfies TweetData;
  }
  const viaS = await fetchViaSyndication(id);
  if (viaS?.text || viaS?.images?.length) {
    debug('fetchTweet using syndication', { id });
    return { ...base, ...viaS } satisfies TweetData;
  }
  // Final fallback: use Jina to read fxtwitter page by ID
  try {
    const res = await fetchText(`https://r.jina.ai/http://fxtwitter.com/i/status/${id}`);
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 0) {
        debug('fetchTweet using fxtwitter+jina', { id, textLen: text.length });
        return { ...base, text, images: [] };
      }
    }
  } catch {
    // ignore
  }
  return null;
}
