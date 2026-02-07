import { describe, expect, it } from 'vitest';
import { MODEL_ALIASES, resolveModelAlias } from '../../src/llm/index.js';

describe('resolveModelAlias', () => {
  it('resolves "qwen3-coder" to OpenRouter defaults', () => {
    const alias = resolveModelAlias('qwen3-coder');
    expect(alias).toEqual({
      model: 'qwen/qwen3-coder:free',
      provider: 'openai',
      base_url: 'https://openrouter.ai/api/v1',
      api_key_env: 'OPENROUTER_API_KEY',
    });
  });

  it('resolves "deepseek" to DeepSeek defaults', () => {
    const alias = resolveModelAlias('deepseek');
    expect(alias).toEqual({
      model: 'deepseek-chat',
      provider: 'openai',
      base_url: 'https://api.deepseek.com',
      api_key_env: 'DEEPSEEK_API_KEY',
    });
  });

  it('resolves "kimi" to Moonshot defaults', () => {
    const alias = resolveModelAlias('kimi');
    expect(alias).toEqual({
      model: 'kimi-k2.5',
      provider: 'openai',
      base_url: 'https://api.moonshot.cn/v1',
      api_key_env: 'MOONSHOT_API_KEY',
    });
  });

  it('returns undefined for non-alias model names', () => {
    expect(resolveModelAlias('claude-sonnet-4-20250514')).toBeUndefined();
    expect(resolveModelAlias('deepseek-chat')).toBeUndefined();
    expect(resolveModelAlias('qwen/qwen3-coder:free')).toBeUndefined();
    expect(resolveModelAlias('unknown-model')).toBeUndefined();
  });
});

describe('MODEL_ALIASES', () => {
  it('contains entries for all expected aliases', () => {
    expect(Object.keys(MODEL_ALIASES)).toEqual(
      expect.arrayContaining(['qwen3-coder', 'deepseek', 'kimi']),
    );
  });

  it('all entries have required fields', () => {
    for (const [name, entry] of Object.entries(MODEL_ALIASES)) {
      expect(entry.model, `${name}.model`).toBeTruthy();
      expect(entry.provider, `${name}.provider`).toBe('openai');
      expect(entry.base_url, `${name}.base_url`).toMatch(/^https:\/\//);
      expect(entry.api_key_env, `${name}.api_key_env`).toBeTruthy();
    }
  });
});
