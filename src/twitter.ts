/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Utilities to parse Twitter/X URLs and fetch tweet content (text + images)
// We avoid Twitter API by using public oEmbed + CDN endpoints where possible.
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

const TWITTER_URL_RE = /https?:\/\/(?:x|twitter)\.com\/[^\s/]+\/status\/(\d+)/i;

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

// Strategy 1: syndication CDN (works for many public tweets)
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

// Strategy 2: vxtwitter provides enriched metadata for public tweets
async function fetchViaVxTwitter(id: string): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(`https://api.vxtwitter.com/Twitter/status/${id}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data.text ?? data.tweet?.text ?? '';
    const authorName: string | undefined = data.user_name ?? data.user?.name;
    const authorScreenName: string | undefined = data.user_screen_name ?? data.user?.screen_name;
    const images: string[] = (data.media_extended ?? data.media?.photos ?? [])
      .map((m: any) => m.url ?? m.src ?? m)
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

// Strategy 3: Jina AI Reader API for webpage content extraction as fallback (no key required)
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
  const id = extractTweetId(url);
  if (!id) return null;

  const base: TweetData = { id, url, text: '', images: [] };
  debug('fetchTweet start', { id, url });
  const viaVx = await fetchViaVxTwitter(id);
  if (viaVx && (viaVx.text || viaVx.images?.length)) {
    debug('fetchTweet using vxtwitter', { id });
    return { ...base, ...viaVx } satisfies TweetData;
  }
  const viaJina = await fetchViaJina(url);
  if (viaJina?.text) {
    debug('fetchTweet using jina', { id });
    return { ...base, ...viaJina } satisfies TweetData;
  }
  const viaS = await fetchViaSyndication(id);
  if (viaS && (viaS.text || viaS.images?.length)) {
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
