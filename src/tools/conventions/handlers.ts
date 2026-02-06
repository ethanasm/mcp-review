import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

export interface ScanLintConfigArgs {
  project_root: string;
}

export interface FindSimilarPatternsArgs {
  pattern: string;
  project_root: string;
  file_glob?: string;
}

export interface GetProjectConventionsArgs {
  project_root: string;
}

/**
 * Attempt to read a file, returning null if it does not exist.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Handle scan_lint_config tool call.
 * Find and read linting/formatting config files in the project root.
 */
export async function handleScanLintConfig(args: ScanLintConfigArgs): Promise<string> {
  const root = args.project_root;
  const configs: { file: string; content: string }[] = [];

  // Config files to look for, in order of priority
  const configFiles = [
    'biome.json',
    'biome.jsonc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    '.eslintrc',
    'eslint.config.js',
    'eslint.config.mjs',
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.js',
    'prettier.config.js',
    'tsconfig.json',
    '.editorconfig',
  ];

  for (const file of configFiles) {
    const content = await tryReadFile(join(root, file));
    if (content !== null) {
      // Truncate very large config files
      const truncated = content.length > 5000 ? `${content.substring(0, 5000)}\n... (truncated)` : content;
      configs.push({ file, content: truncated });
    }
  }

  if (configs.length === 0) {
    return 'No lint or formatting configuration files found in the project root.';
  }

  return configs.map((c) => `--- ${c.file} ---\n${c.content}`).join('\n\n');
}

// Check if a filename matches a simple glob pattern.
// Supports: "*.<ext>" (e.g. "*.ts"), "**\/*.<ext>", or exact filename match.
function matchesGlob(filename: string, pattern: string): boolean {
  // Strip leading **/ if present
  const cleaned = pattern.replace(/^\*\*\//, '');

  if (cleaned.startsWith('*.')) {
    const ext = cleaned.substring(1); // e.g. ".ts"
    return filename.endsWith(ext);
  }

  return filename === cleaned;
}

/**
 * Recursively collect file paths matching a glob, up to a max count.
 */
async function collectFiles(
  dir: string,
  pattern: string | undefined,
  maxFiles: number,
  depth: number = 0,
): Promise<string[]> {
  if (depth > 10) return [];

  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) break;

    // Skip common non-source directories
    if (
      entry.isDirectory() &&
      (entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === 'coverage' ||
        entry.name === '.next' ||
        entry.name === 'build')
    ) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, pattern, maxFiles - results.length, depth + 1);
      results.push(...subFiles);
    } else if (entry.isFile()) {
      if (!pattern || matchesGlob(entry.name, pattern)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Handle find_similar_patterns tool call.
 * Search for a pattern string across source files, returning matching excerpts.
 */
export async function handleFindSimilarPatterns(args: FindSimilarPatternsArgs): Promise<string> {
  const fileGlob = args.file_glob ?? '*.ts';
  const files = await collectFiles(args.project_root, fileGlob, 200);

  const matches: { file: string; lineNum: number; line: string }[] = [];
  const maxMatches = 30;

  for (const filePath of files) {
    if (matches.length >= maxMatches) break;

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) break;

      const line = lines[i];
      if (line !== undefined && line.includes(args.pattern)) {
        const relativePath = filePath.startsWith(args.project_root)
          ? filePath.substring(args.project_root.length + 1)
          : filePath;
        matches.push({ file: relativePath, lineNum: i + 1, line: line.trim() });
      }
    }
  }

  if (matches.length === 0) {
    return `No matches found for pattern "${args.pattern}" in ${fileGlob} files.`;
  }

  const header = `Found ${matches.length} match${matches.length > 1 ? 'es' : ''} for "${args.pattern}":\n`;
  const body = matches.map((m) => `  ${m.file}:${m.lineNum}: ${m.line}`).join('\n');
  return header + body;
}

/**
 * Handle get_project_conventions tool call.
 * Read the .mcp-review.yml conventions field from the project root.
 */
export async function handleGetProjectConventions(args: GetProjectConventionsArgs): Promise<string> {
  const ymlPath = join(args.project_root, '.mcp-review.yml');
  const yamlPath = join(args.project_root, '.mcp-review.yaml');

  const content = (await tryReadFile(ymlPath)) ?? (await tryReadFile(yamlPath));

  if (content === null) {
    return 'No .mcp-review.yml or .mcp-review.yaml configuration file found.';
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error parsing .mcp-review.yml: ${message}`;
  }

  if (parsed === null || typeof parsed !== 'object') {
    return 'Configuration file is empty or invalid.';
  }

  const config = parsed as Record<string, unknown>;

  // Return conventions section if present, otherwise the full config
  if (config['conventions']) {
    return JSON.stringify(config['conventions'], null, 2);
  }

  return JSON.stringify(config, null, 2);
}
