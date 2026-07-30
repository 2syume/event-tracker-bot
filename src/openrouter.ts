// Minimal OpenRouter client wrapper around the official SDK
import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatFormatJsonSchemaConfig,
  ChatFunctionTool,
  ResponseHealingPlugin,
} from '@openrouter/sdk/models';

import { debug } from './debug';

const OPENROUTER_SERVER_TOOLS = [
  { type: 'openrouter:web_search' },
  { type: 'openrouter:web_fetch' },
] satisfies ChatFunctionTool[];

const OPENROUTER_PLUGINS = [{ id: 'response-healing' }] satisfies ResponseHealingPlugin[];

function normalizeContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // OpenAI-compatible: [{ type: 'text', text: '...' }, { type: 'image_url', ... }]
    const parts = content
      .map((part) => {
        if (part && typeof part === 'object') {
          const maybeType = (part as { type?: unknown }).type;
          if (maybeType === 'text') {
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
        }
        return '';
      })
      .filter((p) => p.length > 0);
    return parts.join('');
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
  | { role: 'assistant'; content: string };

export type ChatOptions = {
  model: string;
  /** Enforce JSON Schema output (overrides responseFormat when set). */
  enforcedJsonSchema?: {
    /** Identifier used by the model (required by the API). */
    name: string;
    /** Optional description of the schema. */
    description?: string;
    /** JSON Schema object (Draft-07-ish). */
    schema: Record<string, unknown>;
  };
  /** Allow OpenRouter's web search/fetch server tools for this request. */
  enableWebTools?: boolean;
  temperature?: number;
};

export async function chat(messages: ChatMessage[], opts: ChatOptions, signal?: AbortSignal) {
  const key = process.env.OPENROUTER_API_KEY ?? '';
  if (!key) throw new Error('Missing OPENROUTER_API_KEY');
  const start = Date.now();
  const client = new OpenRouter({ apiKey: key });

  const enforcedResponseFormat: ChatFormatJsonSchemaConfig | undefined = opts.enforcedJsonSchema
    ? {
        type: 'json_schema',
        jsonSchema: {
          name: opts.enforcedJsonSchema.name,
          description: opts.enforcedJsonSchema.description,
          schema: opts.enforcedJsonSchema.schema,
          strict: true,
        },
      }
    : undefined;

  const result = await client.chat.send(
    {
      chatRequest: {
        model: opts.model,
        // SDK message shape is OpenAI-compatible; our ChatMessage is compatible.
        messages: messages,
        stream: false,
        temperature: opts.temperature ?? 0,
        responseFormat: enforcedResponseFormat,
        provider: enforcedResponseFormat ? { requireParameters: true } : undefined,
        tools: opts.enableWebTools ? OPENROUTER_SERVER_TOOLS : undefined,
        plugins: OPENROUTER_PLUGINS,
        reasoning: { effort: 'low' },
      },
    },
    {
      fetchOptions: {
        signal,
      },
    },
  );

  const choice = result.choices[0];
  if (!choice) throw new Error('OpenRouter returned no completion choice');
  if (choice.finishReason !== 'stop') {
    throw new Error(
      `OpenRouter completion did not finish normally: ${choice.finishReason ?? 'null'}`,
    );
  }
  if (choice.message.refusal)
    throw new Error(`OpenRouter refused the request: ${choice.message.refusal}`);
  if (choice.message.toolCalls?.length) {
    throw new Error('OpenRouter returned unfinished tool calls instead of final content');
  }

  const contentRaw: unknown = choice.message.content;
  const content = normalizeContentToString(contentRaw).trim();
  if (!content) throw new Error('OpenRouter returned empty completion content');
  debug('openrouter.chat', {
    model: opts.model,
    resolvedModel: result.model,
    finishReason: choice.finishReason,
    ms: Date.now() - start,
    contentLen: content.length,
  });
  return content;
}
