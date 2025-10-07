// Utilities to parse Twitter/X URLs and fetch tweet content (text + images)
// We avoid Twitter API by using public oEmbed + CDN endpoints where possible.
import { debug } from "./debug";

export type TweetMedia = {
  type: "photo" | "video" | "animated_gif" | "unknown";
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
};

const TWITTER_URL_RE =
  /https?:\/\/(?:x|twitter)\.com\/[^\s\/]+\/status\/(\d+)/i;

export function extractTweetId(input: string): string | null {
  const m = input.match(TWITTER_URL_RE);
  return m?.[1] ?? null;
}

async function fetchText(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.HTTP_TIMEOUT_MS ?? 20000)
  );
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...(init?.headers || {}), "User-Agent": "Mozilla/5.0" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

// Strategy 1: syndication CDN (works for many public tweets)
async function fetchViaSyndication(
  id: string
): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en`
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    // Known fields: text, user.name, user.screen_name, entities.media
    const text: string = data.text ?? "";
    const authorName: string | undefined = data.user?.name;
    const authorScreenName: string | undefined = data.user?.screen_name;
    const images: string[] = (data.entities?.media || [])
      .filter((m: any) => m.type === "photo" && m.media_url_https)
      .map((m: any) => m.media_url_https);
    const result = { text, authorName, authorScreenName, images };
    debug("fetchViaSyndication ok", {
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
async function fetchViaVxTwitter(
  id: string
): Promise<Partial<TweetData> | null> {
  try {
    const res = await fetchText(
      `https://api.vxtwitter.com/Twitter/status/${id}`
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data.text ?? data.tweet?.text ?? "";
    const authorName: string | undefined = data.user_name ?? data.user?.name;
    const authorScreenName: string | undefined =
      data.user_screen_name ?? data.user?.screen_name;
    const images: string[] = (data.media_extended ?? data.media?.photos ?? [])
      .map((m: any) => m.url || m.src || m)
      .filter(Boolean);
    const result = { text, authorName, authorScreenName, images };
    debug("fetchViaVxTwitter ok", {
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
    const res = await fetchText(
      "https://r.jina.ai/http://" + url.replace(/^https?:\/\//, "")
    );
    if (!res.ok) return null;
    const text = await res.text();
    debug("fetchViaJina ok", { url, textLen: text.length });
    return { text, images: [] };
  } catch {
    return null;
  }
}

export async function fetchTweet(url: string): Promise<TweetData | null> {
  const id = extractTweetId(url);
  if (!id) return null;

  const base: TweetData = { id, url, text: "", images: [] };
  debug("fetchTweet start", { id, url });
  const viaVx = await fetchViaVxTwitter(id);
  if (viaVx && (viaVx.text || (viaVx.images && viaVx.images.length))) {
    debug("fetchTweet using vxtwitter", { id });
    return { ...base, ...viaVx } as TweetData;
  }
  const viaJina = await fetchViaJina(url);
  if (viaJina && viaJina.text) {
    debug("fetchTweet using jina", { id });
    return { ...base, ...viaJina } as TweetData;
  }
  const viaS = await fetchViaSyndication(id);
  if (viaS && (viaS.text || (viaS.images && viaS.images.length))) {
    debug("fetchTweet using syndication", { id });
    return { ...base, ...viaS } as TweetData;
  }
  // Final fallback: use Jina to read fxtwitter page by ID
  try {
    const res = await fetchText(
      `https://r.jina.ai/http://fxtwitter.com/i/status/${id}`
    );
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 0) {
        debug("fetchTweet using fxtwitter+jina", { id, textLen: text.length });
        return { ...base, text, images: [] };
      }
    }
  } catch {}
  return null;
}
