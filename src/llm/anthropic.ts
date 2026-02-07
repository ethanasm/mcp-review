import Anthropic from '@anthropic-ai/sdk';
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

export interface AnthropicProviderOptions {
  /** Optional spinner for user feedback during retries. */
  spinner?: Ora;
}

/**
 * Anthropic provider — wraps the Anthropic SDK and implements LLMProvider.
 */
export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): LLMProvider {
  const client = new Anthropic();

  async function callWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await client.messages.create(params);
      } catch (error) {
        const isRateLimit =
          error instanceof Anthropic.RateLimitError ||
          (error instanceof Anthropic.APIError && error.status === 429);

        if (!isRateLimit || attempt >= MAX_RETRIES) {
          throw error;
        }

        const retryAfter =
          error instanceof Anthropic.APIError ? error.headers?.['retry-after'] : undefined;
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
      }
    }

    throw new Error('Exhausted retries');
  }

  function normalizeResponse(msg: Anthropic.Message): LLMResponse {
    const content: ContentBlock[] = msg.content.map((block) => {
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        } satisfies ToolUseBlock;
      }
      return { type: 'text' as const, text: (block as Anthropic.TextBlock).text };
    });

    let stopReason: LLMResponse['stopReason'];
    switch (msg.stop_reason) {
      case 'tool_use':
        stopReason = 'tool_use';
        break;
      case 'end_turn':
        stopReason = 'end_turn';
        break;
      case 'max_tokens':
        stopReason = 'max_tokens';
        break;
      default:
        stopReason = 'unknown';
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      },
    };
  }

  return {
    async call(request: LLMRequest): Promise<LLMResponse> {
      const tools: Anthropic.Tool[] | undefined = request.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool['input_schema'],
      }));

      const messages: Anthropic.MessageParam[] = request.messages.map((m) => {
        if (typeof m.content === 'string') {
          return { role: m.role, content: m.content };
        }
        // Array content — map ContentBlock[] or ToolResultContent[] to Anthropic format
        const blocks = m.content.map((block) => {
          if (block.type === 'tool_result') {
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          }
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }
          return { type: 'text' as const, text: block.text };
        });
        return { role: m.role, content: blocks } as Anthropic.MessageParam;
      });

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.max_tokens,
        system: request.system,
        messages,
        ...(tools && tools.length > 0 ? { tools } : {}),
      };

      const msg = await callWithRetry(params);
      return normalizeResponse(msg);
    },
  };
}
