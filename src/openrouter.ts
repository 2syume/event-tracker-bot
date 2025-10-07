// Minimal OpenRouter client for chat completions (JSON and translation)
import { debug } from './debug';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
};

export type ChatOptions = {
  model: string;
  response_format?: { type: 'json_object' | 'text' };
  temperature?: number;
};

export async function chat(messages: ChatMessage[], opts: ChatOptions, signal?: AbortSignal) {
  const key = process.env.OPENROUTER_API_KEY ?? '';
  if (!key) throw new Error('Missing OPENROUTER_API_KEY');
  const start = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/your/org', // optional
      'X-Title': 'event-tracker-bot',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0,
      response_format: opts.response_format,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const content = json?.choices?.[0]?.message?.content ?? '';
  debug('openrouter.chat', {
    model: opts.model,
    ms: Date.now() - start,
    contentLen: String(content).length,
  });
  return String(content);
}
