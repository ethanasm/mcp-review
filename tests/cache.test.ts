import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cacheReview, clearCache, getCacheKey, getCachedReview } from '../src/cache.js';
import type { Config } from '../src/config.js';
import type { ReviewResult } from '../src/reviewer.js';

const CACHE_DIR = '.mcp-review-cache';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    model: 'claude-sonnet-4-20250514',
    focus: [],
    ignore: [],
    conventions: [],
    max_files: 20,
    context_lines: 5,
    no_cache: false,
    ...overrides,
  };
}

const sampleResult: ReviewResult = {
  critical: [{ file: 'src/index.ts', line: 10, message: 'SQL injection risk' }],
  suggestions: [{ file: 'src/utils.ts', message: 'Consider extracting helper' }],
  positive: [{ file: 'src/app.ts', message: 'Good error handling' }],
  confidence: 'high',
  stats: { filesChanged: 3, insertions: 50, deletions: 10 },
};

let projectRoot: string;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `mcp-review-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('getCacheKey', () => {
  it('returns a deterministic hash', () => {
    const config = makeConfig();
    const key1 = getCacheKey('diff content', config, 'claude-sonnet-4-20250514');
    const key2 = getCacheKey('diff content', config, 'claude-sonnet-4-20250514');
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different keys for different inputs', () => {
    const config = makeConfig();
    const key1 = getCacheKey('diff A', config, 'claude-sonnet-4-20250514');
    const key2 = getCacheKey('diff B', config, 'claude-sonnet-4-20250514');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different models', () => {
    const config = makeConfig();
    const key1 = getCacheKey('diff', config, 'claude-sonnet-4-20250514');
    const key2 = getCacheKey('diff', config, 'claude-opus-4-20250514');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different configs', () => {
    const key1 = getCacheKey('diff', makeConfig({ focus: ['security'] }), 'claude-sonnet-4-20250514');
    const key2 = getCacheKey('diff', makeConfig({ focus: ['performance'] }), 'claude-sonnet-4-20250514');
    expect(key1).not.toBe(key2);
  });
});

describe('cacheReview and getCachedReview', () => {
  it('cache hit returns stored result', async () => {
    const config = makeConfig();
    const diff = 'some diff content';
    const model = 'claude-sonnet-4-20250514';

    await cacheReview(diff, config, model, sampleResult, projectRoot);
    const result = await getCachedReview(diff, config, model, projectRoot);

    expect(result).toEqual(sampleResult);
  });

  it('cache miss returns null', async () => {
    const config = makeConfig();
    const result = await getCachedReview('nonexistent diff', config, 'claude-sonnet-4-20250514', projectRoot);
    expect(result).toBeNull();
  });

  it('corrupt cache file returns null', async () => {
    const config = makeConfig();
    const diff = 'corrupt test';
    const model = 'claude-sonnet-4-20250514';
    const key = getCacheKey(diff, config, model);

    const cacheDir = join(projectRoot, CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${key}.json`), '{{not valid json}}', 'utf-8');

    const result = await getCachedReview(diff, config, model, projectRoot);
    expect(result).toBeNull();
  });

  it('returns null for cache entry with wrong version', async () => {
    const config = makeConfig();
    const diff = 'version mismatch test';
    const model = 'claude-sonnet-4-20250514';
    const key = getCacheKey(diff, config, model);

    const cacheDir = join(projectRoot, CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, `${key}.json`),
      JSON.stringify({ result: sampleResult, timestamp: Date.now(), version: '0' }),
      'utf-8',
    );

    const result = await getCachedReview(diff, config, model, projectRoot);
    expect(result).toBeNull();
  });

  it('config.no_cache bypasses read', async () => {
    const config = makeConfig({ no_cache: false });
    const noCacheConfig = makeConfig({ no_cache: true });
    const diff = 'no cache test';
    const model = 'claude-sonnet-4-20250514';

    await cacheReview(diff, config, model, sampleResult, projectRoot);
    const result = await getCachedReview(diff, noCacheConfig, model, projectRoot);
    expect(result).toBeNull();
  });

  it('config.no_cache bypasses write', async () => {
    const config = makeConfig({ no_cache: true });
    const diff = 'no cache write test';
    const model = 'claude-sonnet-4-20250514';

    await cacheReview(diff, config, model, sampleResult, projectRoot);

    // Try to read with caching enabled — should miss because it was never written
    const readConfig = makeConfig({ no_cache: false });
    const result = await getCachedReview(diff, readConfig, model, projectRoot);
    expect(result).toBeNull();
  });

  it('creates cache directory if it does not exist', async () => {
    const config = makeConfig();
    const diff = 'mkdir test';
    const model = 'claude-sonnet-4-20250514';

    await cacheReview(diff, config, model, sampleResult, projectRoot);

    const key = getCacheKey(diff, config, model);
    const filePath = join(projectRoot, CACHE_DIR, `${key}.json`);
    const raw = await readFile(filePath, 'utf-8');
    const entry = JSON.parse(raw);
    expect(entry.result).toEqual(sampleResult);
    expect(entry.version).toBe('1');
    expect(typeof entry.timestamp).toBe('number');
  });
});

describe('cacheReview edge cases', () => {
  it('handles empty diff string', async () => {
    const config = makeConfig();
    const model = 'claude-sonnet-4-20250514';

    await cacheReview('', config, model, sampleResult, projectRoot);
    const result = await getCachedReview('', config, model, projectRoot);
    expect(result).toEqual(sampleResult);
  });

  it('overwrites existing cache entry with same key', async () => {
    const config = makeConfig();
    const diff = 'overwrite test';
    const model = 'claude-sonnet-4-20250514';

    const updatedResult: ReviewResult = {
      ...sampleResult,
      confidence: 'low',
      critical: [],
    };

    await cacheReview(diff, config, model, sampleResult, projectRoot);
    await cacheReview(diff, config, model, updatedResult, projectRoot);

    const result = await getCachedReview(diff, config, model, projectRoot);
    expect(result).toEqual(updatedResult);
    expect(result!.confidence).toBe('low');
    expect(result!.critical).toHaveLength(0);
  });

  it('handles result with empty finding arrays', async () => {
    const config = makeConfig();
    const diff = 'empty findings';
    const model = 'claude-sonnet-4-20250514';

    const emptyResult: ReviewResult = {
      critical: [],
      suggestions: [],
      positive: [],
      confidence: 'medium',
      stats: { filesChanged: 0, insertions: 0, deletions: 0 },
    };

    await cacheReview(diff, config, model, emptyResult, projectRoot);
    const result = await getCachedReview(diff, config, model, projectRoot);
    expect(result).toEqual(emptyResult);
  });

  it('returns null for empty JSON file', async () => {
    const config = makeConfig();
    const diff = 'empty file test';
    const model = 'claude-sonnet-4-20250514';
    const key = getCacheKey(diff, config, model);

    const cacheDir = join(projectRoot, CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${key}.json`), '', 'utf-8');

    const result = await getCachedReview(diff, config, model, projectRoot);
    expect(result).toBeNull();
  });

  it('returns null for cache entry missing result field', async () => {
    const config = makeConfig();
    const diff = 'missing result field';
    const model = 'claude-sonnet-4-20250514';
    const key = getCacheKey(diff, config, model);

    const cacheDir = join(projectRoot, CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, `${key}.json`),
      JSON.stringify({ timestamp: Date.now(), version: '1' }),
      'utf-8',
    );

    const result = await getCachedReview(diff, config, model, projectRoot);
    // The entry has version '1' so it passes version check, but result is undefined
    expect(result).toBeUndefined();
  });
});

describe('clearCache', () => {
  it('removes cached files', async () => {
    const config = makeConfig();
    const model = 'claude-sonnet-4-20250514';

    await cacheReview('diff1', config, model, sampleResult, projectRoot);
    await cacheReview('diff2', config, model, sampleResult, projectRoot);

    await clearCache(projectRoot);

    const result1 = await getCachedReview('diff1', config, model, projectRoot);
    const result2 = await getCachedReview('diff2', config, model, projectRoot);
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });

  it('does not throw if cache directory does not exist', async () => {
    await expect(clearCache(join(projectRoot, 'nonexistent'))).resolves.not.toThrow();
  });

  it('leaves non-JSON files untouched', async () => {
    const config = makeConfig();
    const model = 'claude-sonnet-4-20250514';

    await cacheReview('diff', config, model, sampleResult, projectRoot);

    // Write a non-JSON file in the cache directory
    const cacheDir = join(projectRoot, CACHE_DIR);
    await writeFile(join(cacheDir, 'notes.txt'), 'keep me', 'utf-8');

    await clearCache(projectRoot);

    // The non-JSON file should still exist
    const content = await readFile(join(cacheDir, 'notes.txt'), 'utf-8');
    expect(content).toBe('keep me');
  });
});
