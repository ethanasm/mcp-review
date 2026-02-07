import type { Ora } from 'ora';
import { debug } from '../logger.js';
import type {
  ContentBlock,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ToolUseBlock,
} from './provider.js';

/** Max retries for rate-limit (429) errors. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff on rate-limit errors. */
const RETRY_BASE_DELAY_MS = 30_000;

export interface OpenAIProviderOptions {
  /** Base URL for the OpenAI-compatible API (e.g. https://openrouter.ai/api/v1). */
  baseURL: string;
  /** API key. */
  apiKey: string;
  /** Optional spinner for user feedback during retries. */
  spinner?: Ora;
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatResponse {
  choices: {
    finish_reason: string;
    message: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * OpenAI-compatible provider.
 *
 * Works with OpenRouter, DeepSeek, Kimi, and any endpoint implementing
 * the OpenAI chat completions API.
 */
export function createOpenAIProvider(opts: OpenAIProviderOptions): LLMProvider {
  const { baseURL, apiKey } = opts;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('OpenAI provider requires a non-empty API key');
  }
  // Ensure the URL ends with /chat/completions
  const endpoint = baseURL.replace(/\/+$/, '').endsWith('/chat/completions')
    ? baseURL
    : `${baseURL.replace(/\/+$/, '')}/chat/completions`;

  async function fetchWithRetry(body: Record<string, unknown>): Promise<OpenAIChatResponse> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'mcp-review',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return (await res.json()) as OpenAIChatResponse;
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get('retry-after');
        const delaySec = retryAfter ? Number.parseInt(retryAfter, 10) : 0;
        const delayMs = delaySec > 0 ? delaySec * 1000 : RETRY_BASE_DELAY_MS * 2 ** attempt;

        debug(
          'llm',
          `Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s`,
        );

        if (opts.spinner) {
          opts.spinner.text = `Rate limited — retrying in ${Math.round(delayMs / 1000)}s...`;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      const text = await res.text();
      throw new Error(`OpenAI API error (HTTP ${res.status}): ${text}`);
    }

    throw new Error('Exhausted retries');
  }

  function buildMessages(request: LLMRequest): OpenAIChatMessage[] {
    const messages: OpenAIChatMessage[] = [{ role: 'system', content: request.system }];

    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Array content — could be ContentBlock[] or ToolResultContent[]
      const blocks = msg.content;

      // Check if this is a tool-results message (role: 'user' with tool_result blocks)
      if (blocks.length > 0 && blocks[0]!.type === 'tool_result') {
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }
        continue;
      }

      // Assistant message with mixed text + tool_use blocks
      if (msg.role === 'assistant') {
        let textContent = '';
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of blocks) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            // Sanitize: only serialize plain-object inputs to prevent injection
            const safeInput =
              block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                ? block.input
                : {};
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(safeInput),
              },
            });
          }
        }

        const assistantMsg: OpenAIChatMessage = {
          role: 'assistant',
          content: textContent || null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);
        continue;
      }

      // User message with text blocks
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      messages.push({ role: 'user', content: text });
    }

    return messages;
  }

  function buildTools(request: LLMRequest): OpenAIToolDef[] | undefined {
    if (!request.tools || request.tools.length === 0) return undefined;
    return request.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  function normalizeResponse(resp: OpenAIChatResponse): LLMResponse {
    const choice = resp.choices[0];
    if (!choice) {
      throw new Error('OpenAI API returned no choices');
    }

    const content: ContentBlock[] = [];

    // Text content
    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    // Tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(tc.function.arguments);
        } catch {
          parsed = {};
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsed,
        } satisfies ToolUseBlock);
      }
    }

    let stopReason: LLMResponse['stopReason'];
    switch (choice.finish_reason) {
      case 'tool_calls':
        stopReason = 'tool_use';
        break;
      case 'stop':
        stopReason = 'end_turn';
        break;
      case 'length':
        stopReason = 'max_tokens';
        break;
      default:
        stopReason = 'unknown';
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      },
    };
  }

  return {
    async call(request: LLMRequest): Promise<LLMResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.max_tokens,
        messages: buildMessages(request),
      };

      const tools = buildTools(request);
      if (tools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const resp = await fetchWithRetry(body);
      return normalizeResponse(resp);
    },
  };
}
