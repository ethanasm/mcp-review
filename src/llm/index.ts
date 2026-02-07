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
 * Model alias definitions.
 *
 * Short names that auto-resolve to a full model ID plus provider defaults,
 * so users can write `--model qwen3-coder` instead of specifying
 * `--provider openai --base-url … --api-key-env …` every time.
 */
export interface ModelAliasEntry {
  /** Full model ID sent to the API. */
  model: string;
  /** Provider type. */
  provider: 'anthropic' | 'openai';
  /** Base URL for OpenAI-compatible endpoints. */
  base_url: string;
  /** Environment variable name for the API key. */
  api_key_env: string;
}

export const MODEL_ALIASES: Record<string, ModelAliasEntry> = {
  'qwen3-coder': {
    model: 'qwen/qwen3-coder:free',
    provider: 'openai',
    base_url: 'https://openrouter.ai/api/v1',
    api_key_env: 'OPENROUTER_API_KEY',
  },
  deepseek: {
    model: 'deepseek-chat',
    provider: 'openai',
    base_url: 'https://api.deepseek.com',
    api_key_env: 'DEEPSEEK_API_KEY',
  },
  kimi: {
    model: 'kimi-k2.5',
    provider: 'openai',
    base_url: 'https://api.moonshot.cn/v1',
    api_key_env: 'MOONSHOT_API_KEY',
  },
};

/**
 * Resolve a model alias to its full configuration.
 * Returns `undefined` if the model name is not an alias.
 */
export function resolveModelAlias(model: string): ModelAliasEntry | undefined {
  return MODEL_ALIASES[model];
}

/**
 * Create an LLMProvider based on the config.
 *
 * If `config.model` matches a known alias, the alias defaults are used
 * for provider, base_url, and api_key_env (explicit config values take
 * precedence).
 *
 * - `provider: 'anthropic'` (default) uses the Anthropic SDK.
 * - `provider: 'openai'` uses any OpenAI-compatible endpoint.
 */
export function createProvider(config: Config, spinner?: Ora): LLMProvider {
  const alias = resolveModelAlias(config.model);

  const cfgProvider = (config as Config & { provider?: string }).provider;
  const cfgBaseUrl = (config as Config & { base_url?: string }).base_url;
  const cfgApiKeyEnv = (config as Config & { api_key_env?: string }).api_key_env;

  const provider = cfgProvider ?? alias?.provider ?? 'anthropic';
  const baseURL = cfgBaseUrl ?? alias?.base_url;
  const apiKeyEnv = cfgApiKeyEnv ?? alias?.api_key_env;

  if (provider === 'openai') {
    const keyEnv = apiKeyEnv ?? 'OPENAI_API_KEY';
    const apiKey = process.env[keyEnv];

    if (!baseURL) {
      throw new Error(
        'provider "openai" requires a base_url (e.g. --base-url https://openrouter.ai/api/v1)',
      );
    }
    if (!apiKey) {
      throw new Error(`API key not found. Set the ${keyEnv} environment variable.`);
    }

    return createOpenAIProvider({ baseURL, apiKey, spinner });
  }

  // Default: Anthropic
  const anthropicKeyEnv = apiKeyEnv ?? 'ANTHROPIC_API_KEY';
  const anthropicKey = process.env[anthropicKeyEnv];
  return createAnthropicProvider({ apiKey: anthropicKey, spinner });
}
