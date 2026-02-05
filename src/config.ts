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
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_FILES = ['.mcp-review.yml', '.mcp-review.yaml', '.mcp-review.json'];

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  // Try to find and load config file
  for (const filename of CONFIG_FILES) {
    const filepath = `${cwd}/${filename}`;
    if (existsSync(filepath)) {
      try {
        const content = await readFile(filepath, 'utf-8');
        const parsed = filename.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
        return ConfigSchema.parse(parsed);
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
