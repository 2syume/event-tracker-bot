import { CONFIG } from './config';
import { debug } from './debug';

export type WebPageData = {
  url: string;
  text: string;
};

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars) + `\n\n[truncated to ${maxChars} chars]`;
}

async function fetchText(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.httpTimeoutMs);
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

/**
 * Fetch readable page text using Jina AI Reader (no key required).
 * This keeps the implementation light and avoids per-site scraping.
 */
export async function fetchWebPage(url: string): Promise<WebPageData | null> {
  try {
    const readerUrl = 'https://r.jina.ai/http://' + url.replace(/^https?:\/\//, '');
    const res = await fetchText(readerUrl);
    if (!res.ok) return null;
    const text = truncateText(await res.text(), 30000);
    debug('fetchWebPage ok', { url, textLen: text.length });
    return { url, text };
  } catch (e) {
    debug('fetchWebPage error', (e as Error).message);
    return null;
  }
}
