import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, mergeConfig, shouldIgnoreFile } from '../src/config.js';

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
      provider: 'anthropic',
      focus: [],
      ignore: [],
      conventions: [],
      max_files: 20,
      context_lines: 5,
      no_cache: false,
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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

describe('shouldIgnoreFile', () => {
  it('returns false for empty patterns', () => {
    expect(shouldIgnoreFile('src/index.ts', [])).toBe(false);
  });

  it('matches exact filename pattern', () => {
    expect(shouldIgnoreFile('src/foo.test.ts', ['*.test.ts'])).toBe(true);
  });

  it('matches extension pattern against deeply nested files', () => {
    expect(shouldIgnoreFile('src/utils/deep/foo.test.ts', ['*.test.ts'])).toBe(true);
  });

  it('does not match when extension differs', () => {
    expect(shouldIgnoreFile('src/foo.ts', ['*.test.ts'])).toBe(false);
  });

  it('matches ** recursive glob', () => {
    expect(shouldIgnoreFile('dist/index.js', ['dist/**'])).toBe(true);
    expect(shouldIgnoreFile('dist/sub/deep/file.js', ['dist/**'])).toBe(true);
  });

  it('does not match ** glob for different directory', () => {
    expect(shouldIgnoreFile('src/index.js', ['dist/**'])).toBe(false);
  });

  it('matches single * glob in directory', () => {
    expect(shouldIgnoreFile('src/foo.js', ['src/*.js'])).toBe(true);
  });

  it('single * does not match across path separators', () => {
    expect(shouldIgnoreFile('src/sub/foo.js', ['src/*.js'])).toBe(false);
  });

  it('matches ? single character glob', () => {
    expect(shouldIgnoreFile('src/a.ts', ['src/?.ts'])).toBe(true);
    expect(shouldIgnoreFile('src/ab.ts', ['src/?.ts'])).toBe(false);
  });

  it('normalizes leading ./ from file path', () => {
    expect(shouldIgnoreFile('./dist/foo.js', ['dist/**'])).toBe(true);
  });

  it('matches **/ prefix pattern', () => {
    expect(shouldIgnoreFile('src/deep/nested/file.generated.ts', ['**/file.generated.ts'])).toBe(
      true,
    );
  });

  it('escapes regex special characters in patterns', () => {
    expect(shouldIgnoreFile('src/file.min.js', ['*.min.js'])).toBe(true);
    expect(shouldIgnoreFile('src/fileminjs', ['*.min.js'])).toBe(false);
  });

  it('handles multiple patterns (match any)', () => {
    expect(shouldIgnoreFile('dist/foo.js', ['*.test.ts', 'dist/**'])).toBe(true);
    expect(shouldIgnoreFile('src/foo.test.ts', ['*.test.ts', 'dist/**'])).toBe(true);
    expect(shouldIgnoreFile('src/foo.ts', ['*.test.ts', 'dist/**'])).toBe(false);
  });
});
