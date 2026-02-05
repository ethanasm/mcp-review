import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, mergeConfig } from '../src/config.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const { existsSync } = await import('node:fs');
const { readFile } = await import('node:fs/promises');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const config = await loadConfig('/fake/dir');
    expect(config).toEqual({
      model: 'claude-sonnet-4-20250514',
      focus: [],
      ignore: [],
      conventions: [],
      max_files: 20,
      context_lines: 5,
    });
  });

  it('loads and parses a YAML config file', async () => {
    vi.mocked(existsSync).mockImplementation((path) => String(path).endsWith('.mcp-review.yml'));
    vi.mocked(readFile).mockResolvedValue('model: claude-opus-4-20250514\nfocus:\n  - security\n');

    const config = await loadConfig('/fake/dir');
    expect(config.model).toBe('claude-opus-4-20250514');
    expect(config.focus).toEqual(['security']);
  });

  it('loads and parses a JSON config file', async () => {
    vi.mocked(existsSync).mockImplementation((path) => String(path).endsWith('.mcp-review.json'));
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ model: 'custom-model', ignore: ['dist'] }),
    );

    const config = await loadConfig('/fake/dir');
    expect(config.model).toBe('custom-model');
    expect(config.ignore).toEqual(['dist']);
  });

  it('falls back to defaults on parse error', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue('{{invalid yaml');

    const config = await loadConfig('/fake/dir');
    expect(config.model).toBe('claude-sonnet-4-20250514');
  });
});

describe('mergeConfig', () => {
  it('overrides base values with defined overrides', () => {
    const base = {
      model: 'claude-sonnet-4-20250514',
      focus: [],
      ignore: [],
      conventions: [],
      max_files: 20,
      context_lines: 5,
    };

    const result = mergeConfig(base, { model: 'claude-opus-4-20250514', focus: ['security'] });
    expect(result.model).toBe('claude-opus-4-20250514');
    expect(result.focus).toEqual(['security']);
    expect(result.max_files).toBe(20);
  });

  it('ignores undefined overrides', () => {
    const base = {
      model: 'claude-sonnet-4-20250514',
      focus: ['perf'],
      ignore: [],
      conventions: [],
      max_files: 20,
      context_lines: 5,
    };

    const result = mergeConfig(base, { model: undefined });
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.focus).toEqual(['perf']);
  });
});
