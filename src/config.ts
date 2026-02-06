import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  focus: z.array(z.string()).default([]),
  ignore: z.array(z.string()).default([]),
  conventions: z.array(z.string()).default([]),
  max_files: z.number().default(20),
  context_lines: z.number().default(5),
  no_cache: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_FILES = ['.mcp-review.yml', '.mcp-review.yaml', '.mcp-review.json'];

export const KNOWN_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-3-5-20241022',
] as const;

/**
 * Warns if the configured model is not in the known models list.
 * This is a warning only — unknown models are still allowed.
 */
export function warnIfUnknownModel(model: string): void {
  if (!(KNOWN_MODELS as readonly string[]).includes(model)) {
    console.warn(`Warning: Unknown model "${model}". Known models: ${KNOWN_MODELS.join(', ')}`);
  }
}

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  // Try to find and load config file
  for (const filename of CONFIG_FILES) {
    const filepath = `${cwd}/${filename}`;
    if (existsSync(filepath)) {
      try {
        const content = await readFile(filepath, 'utf-8');
        const parsed = filename.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
        const config = ConfigSchema.parse(parsed);
        warnIfUnknownModel(config.model);
        return config;
      } catch (error) {
        console.warn(`Warning: Failed to parse ${filename}:`, error);
      }
    }
  }

  // Return defaults if no config file found
  return ConfigSchema.parse({});
}

export function mergeConfig(base: Config, overrides: Partial<Config>): Config {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(overrides).filter(([_, v]) => v !== undefined)),
  };
}

/**
 * Converts a glob-style pattern to a RegExp.
 * Supports:
 * - `*` matches any characters except `/`
 * - `**` matches any characters including `/` (recursive)
 * - `?` matches any single character except `/`
 * - Other characters are escaped for literal matching
 */
function globToRegExp(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i]!;

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**` — match anything including path separators
        if (pattern[i + 2] === '/') {
          // `**/` — match any directory prefix (including empty)
          regexStr += '(?:.+/)?';
          i += 3;
        } else {
          // `**` at end — match anything
          regexStr += '.*';
          i += 2;
        }
      } else {
        // `*` — match anything except `/`
        regexStr += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      regexStr += '[^/]';
      i += 1;
    } else {
      // Escape regex special characters
      regexStr += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }

  return new RegExp(`^${regexStr}$`);
}

/**
 * Checks whether a file path should be ignored based on glob-style patterns.
 *
 * Supported patterns:
 * - `*.test.ts` matches any file ending in `.test.ts` (at any depth)
 * - `dist/**` matches anything under `dist/`
 * - `src/*.js` matches `.js` files directly in `src/`
 */
export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  // Normalize the path: remove leading `./` if present
  const normalized = filePath.replace(/^\.\//, '');

  for (const pattern of ignorePatterns) {
    const regex = globToRegExp(pattern);

    // Test against the full path
    if (regex.test(normalized)) {
      return true;
    }

    // For patterns without `/`, also test against just the basename
    // e.g., `*.test.ts` should match `src/utils/foo.test.ts`
    if (!pattern.includes('/')) {
      const basename = normalized.split('/').pop() ?? normalized;
      if (regex.test(basename)) {
        return true;
      }
    }
  }

  return false;
}
