import { describe, expect, it } from 'vitest';
import { createOpenAIProvider, resolveChatCompletionsEndpoint } from '../../src/llm/openai.js';

describe('resolveChatCompletionsEndpoint', () => {
  it('appends the chat-completions path to a bare base URL', () => {
    expect(resolveChatCompletionsEndpoint('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('trims trailing slashes before appending', () => {
    expect(resolveChatCompletionsEndpoint('https://openrouter.ai/api/v1///')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('leaves a base URL that already targets chat/completions alone', () => {
    const url = 'https://api.deepseek.com/chat/completions';
    expect(resolveChatCompletionsEndpoint(url)).toBe(url);
  });

  it('recognises chat/completions behind trailing slashes', () => {
    const url = 'https://api.deepseek.com/chat/completions/';
    expect(resolveChatCompletionsEndpoint(url)).toBe(url);
  });

  it('handles an all-slash URL without hanging', () => {
    const started = Date.now();
    expect(resolveChatCompletionsEndpoint('/'.repeat(50_000))).toBe('/chat/completions');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('createOpenAIProvider', () => {
  it('rejects a missing API key', () => {
    expect(() => createOpenAIProvider({ baseURL: 'https://example.test/v1', apiKey: '' })).toThrow(
      /non-empty API key/,
    );
  });

  it('rejects a whitespace-only API key', () => {
    expect(() =>
      createOpenAIProvider({ baseURL: 'https://example.test/v1', apiKey: '   ' }),
    ).toThrow(/non-empty API key/);
  });

  it('builds a provider for a valid base URL and key', () => {
    const provider = createOpenAIProvider({
      baseURL: 'https://example.test/v1/',
      apiKey: 'sk-test',
    });
    expect(typeof provider.call).toBe('function');
  });
});
