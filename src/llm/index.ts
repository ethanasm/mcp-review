import type { Ora } from 'ora';
import type { Config } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';
import type { LLMProvider } from './provider.js';

export type { LLMProvider } from './provider.js';
export type {
  ContentBlock,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  TextBlock,
  ToolDefinition,
  ToolResultContent,
  ToolUseBlock,
} from './provider.js';

/**
 * Create an LLMProvider based on the config.
 *
 * - `provider: 'anthropic'` (default) uses the Anthropic SDK.
 * - `provider: 'openai'` uses any OpenAI-compatible endpoint.
 */
export function createProvider(config: Config, spinner?: Ora): LLMProvider {
  const provider = (config as Config & { provider?: string }).provider ?? 'anthropic';

  if (provider === 'openai') {
    const baseURL = (config as Config & { base_url?: string }).base_url;
    const apiKeyEnv = (config as Config & { api_key_env?: string }).api_key_env ?? 'OPENAI_API_KEY';
    const apiKey = process.env[apiKeyEnv];

    if (!baseURL) {
      throw new Error(
        'provider "openai" requires a base_url (e.g. --base-url https://openrouter.ai/api/v1)',
      );
    }
    if (!apiKey) {
      throw new Error(`API key not found. Set the ${apiKeyEnv} environment variable.`);
    }

    return createOpenAIProvider({ baseURL, apiKey, spinner });
  }

  // Default: Anthropic
  return createAnthropicProvider({ spinner });
}
