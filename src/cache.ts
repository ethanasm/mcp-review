import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { ReviewResult } from './reviewer.js';

const CACHE_DIR = '.mcp-review-cache';
const CACHE_VERSION = '1';

interface CacheEntry {
  result: ReviewResult;
  timestamp: number;
  version: string;
}

export function getCacheKey(diffContent: string, config: Config, model: string): string {
  const hash = createHash('sha256');
  hash.update(diffContent);
  hash.update(JSON.stringify(config));
  hash.update(model);
  return hash.digest('hex');
}

export async function getCachedReview(
  diffContent: string,
  config: Config,
  model: string,
  projectRoot: string = process.cwd(),
): Promise<ReviewResult | null> {
  if (config.no_cache) {
    return null;
  }

  const key = getCacheKey(diffContent, config, model);
  const filePath = join(projectRoot, CACHE_DIR, `${key}.json`);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);

    if (entry.version !== CACHE_VERSION) {
      return null;
    }

    return entry.result;
  } catch {
    return null;
  }
}

export async function cacheReview(
  diffContent: string,
  config: Config,
  model: string,
  result: ReviewResult,
  projectRoot: string = process.cwd(),
): Promise<void> {
  if (config.no_cache) {
    return;
  }

  const key = getCacheKey(diffContent, config, model);
  const cacheDir = join(projectRoot, CACHE_DIR);
  const filePath = join(cacheDir, `${key}.json`);

  const entry: CacheEntry = {
    result,
    timestamp: Date.now(),
    version: CACHE_VERSION,
  };

  await mkdir(cacheDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

export async function clearCache(projectRoot: string): Promise<void> {
  const cacheDir = join(projectRoot, CACHE_DIR);

  try {
    const files = await readdir(cacheDir);
    await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => rm(join(cacheDir, f))));
  } catch {
    // Cache directory doesn't exist — nothing to clear
  }
}
