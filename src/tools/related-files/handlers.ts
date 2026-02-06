import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export interface FindImportersArgs {
  file_path: string;
  project_root: string;
}

export interface FindExportsArgs {
  file_path: string;
}

export interface FindTestFilesArgs {
  file_path: string;
  project_root: string;
}

export interface FindTypeReferencesArgs {
  type_name: string;
  project_root: string;
}

interface ImportMatch {
  file: string;
  line: number;
  statement: string;
}

interface ExportEntry {
  name: string;
  kind: 'named' | 'default' | 're-export';
  line: number;
}

interface TypeReference {
  file: string;
  line: number;
  text: string;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.next',
  'build',
  '.turbo',
]);

/**
 * Recursively collect source files from a directory.
 */
async function collectSourceFiles(
  dir: string,
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

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const subFiles = await collectSourceFiles(
        join(dir, entry.name),
        maxFiles - results.length,
        depth + 1,
      );
      results.push(...subFiles);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      results.push(join(dir, entry.name));
    }
  }

  return results;
}

/**
 * Build possible import reference strings for a given file path relative to a project root.
 * E.g. for "src/utils/helpers.ts" returns ["./utils/helpers", "../utils/helpers", "utils/helpers", etc.]
 * We match against the file's relative path without extension and with common variants.
 */
function buildImportTargets(filePath: string, projectRoot: string): string[] {
  const absPath = resolve(projectRoot, filePath);
  const relFromRoot = relative(projectRoot, absPath);

  // Remove extension
  const ext = extname(relFromRoot);
  const withoutExt = relFromRoot.slice(0, -ext.length);

  // Also handle index files
  const base = basename(withoutExt);
  const dir = dirname(withoutExt);

  const targets: string[] = [withoutExt];

  // Without .js extension variant (for .ts -> .js imports)
  targets.push(`${withoutExt}.js`);
  targets.push(`${withoutExt}.ts`);

  // If the file is named "index", also match by directory path
  if (base === 'index') {
    targets.push(dir);
  }

  return targets;
}

/**
 * Handle find_importers tool call.
 * Find files that import or require the given file.
 */
export async function handleFindImporters(args: FindImportersArgs): Promise<string> {
  const files = await collectSourceFiles(args.project_root, 500);
  const targets = buildImportTargets(args.file_path, args.project_root);

  const matches: ImportMatch[] = [];
  const maxMatches = 50;

  // Regex for import/require statements
  const importRegex = /(?:import\s+.*?from\s+['"](.+?)['"]|import\s*\(\s*['"](.+?)['"]\s*\)|require\s*\(\s*['"](.+?)['"]\s*\))/g;

  for (const file of files) {
    if (matches.length >= maxMatches) break;

    // Skip searching the target file itself
    const absTarget = resolve(args.project_root, args.file_path);
    if (resolve(file) === absTarget) continue;

    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) break;

      const line = lines[i];
      if (line === undefined) continue;

      // Reset regex state
      importRegex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(line)) !== null) {
        const importPath = match[1] ?? match[2] ?? match[3];
        if (importPath === undefined) continue;

        // Check if this import resolves to our target file
        if (importMatchesTarget(importPath, file, targets, args.project_root)) {
          const relFile = relative(args.project_root, file);
          matches.push({
            file: relFile,
            line: i + 1,
            statement: line.trim(),
          });
          break; // One match per line is enough
        }
      }
    }
  }

  if (matches.length === 0) {
    return `No files found that import "${args.file_path}".`;
  }

  const header = `Found ${matches.length} file${matches.length > 1 ? 's' : ''} importing "${args.file_path}":\n`;
  const body = matches
    .map((m) => `  ${m.file}:${m.line}: ${m.statement}`)
    .join('\n');
  return header + body;
}

/**
 * Check if an import path from a source file matches one of the target paths.
 */
function importMatchesTarget(
  importPath: string,
  sourceFile: string,
  targets: string[],
  projectRoot: string,
): boolean {
  // For relative imports, resolve from the source file's directory
  if (importPath.startsWith('.')) {
    const sourceDir = dirname(sourceFile);
    const resolved = relative(projectRoot, resolve(sourceDir, importPath));
    // Remove extension for comparison
    const ext = extname(resolved);
    const resolvedNoExt = ext ? resolved.slice(0, -ext.length) : resolved;

    return targets.some((t) => {
      const tExt = extname(t);
      const tNoExt = tExt ? t.slice(0, -tExt.length) : t;
      return resolvedNoExt === tNoExt || resolved === t;
    });
  }

  // For non-relative imports, just check if any target ends with the import path
  return targets.some((t) => t === importPath || t.endsWith(`/${importPath}`));
}

/**
 * Handle find_exports tool call.
 * Parse a file for export statements.
 */
export async function handleFindExports(args: FindExportsArgs): Promise<string> {
  let content: string;
  try {
    content = await readFile(args.file_path, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read file "${args.file_path}": ${message}`);
  }

  const exports: ExportEntry[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();

    // Re-export: export { ... } from '...' or export * from '...'
    if (/^export\s+\*\s+from\s+/.test(trimmed) || /^export\s+\{[^}]*\}\s+from\s+/.test(trimmed)) {
      exports.push({ name: trimmed, kind: 're-export', line: i + 1 });
      continue;
    }

    // Default export
    if (/^export\s+default\s+/.test(trimmed)) {
      // Try to extract the name
      const nameMatch = trimmed.match(
        /^export\s+default\s+(?:class|function|abstract\s+class)\s+(\w+)/,
      );
      const name = nameMatch?.[1] ?? '(anonymous)';
      exports.push({ name, kind: 'default', line: i + 1 });
      continue;
    }

    // Named exports: export const/let/var/function/class/interface/type/enum
    const namedMatch = trimmed.match(
      /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class|abstract\s+class|interface|type|enum)\s+(\w+)/,
    );
    if (namedMatch?.[1]) {
      exports.push({ name: namedMatch[1], kind: 'named', line: i + 1 });
      continue;
    }

    // Named export list: export { a, b, c }
    const listMatch = trimmed.match(/^export\s+\{([^}]+)\}/);
    if (listMatch?.[1]) {
      const names = listMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean);
      for (const name of names) {
        if (name) {
          exports.push({ name, kind: 'named', line: i + 1 });
        }
      }
    }
  }

  if (exports.length === 0) {
    return `No exports found in "${args.file_path}".`;
  }

  const header = `Found ${exports.length} export${exports.length > 1 ? 's' : ''} in "${args.file_path}":\n`;
  const body = exports
    .map((e) => `  L${e.line} [${e.kind}] ${e.name}`)
    .join('\n');
  return header + body;
}

/**
 * Handle find_test_files tool call.
 * Search for test files corresponding to a source file using common conventions.
 */
export async function handleFindTestFiles(args: FindTestFilesArgs): Promise<string> {
  const absPath = resolve(args.project_root, args.file_path);
  const relPath = relative(args.project_root, absPath);
  const ext = extname(relPath);
  const base = basename(relPath, ext);
  const dir = dirname(relPath);

  // Generate candidate test file paths
  const candidates: string[] = [];

  // Same directory: foo.test.ts, foo.spec.ts
  for (const suffix of ['.test', '.spec']) {
    for (const testExt of ['.ts', '.tsx', '.js', '.jsx']) {
      candidates.push(join(dir, `${base}${suffix}${testExt}`));
    }
  }

  // __tests__ directory in same parent
  for (const testExt of ['.ts', '.tsx', '.js', '.jsx']) {
    candidates.push(join(dir, '__tests__', `${base}${testExt}`));
    candidates.push(join(dir, '__tests__', `${base}.test${testExt}`));
    candidates.push(join(dir, '__tests__', `${base}.spec${testExt}`));
  }

  // tests/ mirror: if file is src/foo/bar.ts -> tests/foo/bar.test.ts
  if (dir.startsWith('src')) {
    const testDir = dir.replace(/^src/, 'tests');
    for (const suffix of ['.test', '.spec', '']) {
      for (const testExt of ['.ts', '.tsx', '.js', '.jsx']) {
        candidates.push(join(testDir, `${base}${suffix}${testExt}`));
      }
    }
  }

  const found: string[] = [];

  for (const candidate of candidates) {
    const absCandidate = join(args.project_root, candidate);
    try {
      await readFile(absCandidate, 'utf-8');
      found.push(candidate);
    } catch {
      // File doesn't exist, skip
    }
  }

  if (found.length === 0) {
    return `No test files found for "${args.file_path}".`;
  }

  const header = `Found ${found.length} test file${found.length > 1 ? 's' : ''} for "${args.file_path}":\n`;
  const body = found.map((f) => `  ${f}`).join('\n');
  return header + body;
}

/**
 * Handle find_type_references tool call.
 * Search for type/interface name usage across the codebase.
 */
export async function handleFindTypeReferences(args: FindTypeReferencesArgs): Promise<string> {
  const files = await collectSourceFiles(args.project_root, 500);

  const references: TypeReference[] = [];
  const maxRefs = 50;

  // Build a regex that matches the type name as a whole word
  // Matches: type declarations, interface usage, generic params, type annotations, etc.
  const typeRegex = new RegExp(`\\b${escapeRegex(args.type_name)}\\b`);

  for (const file of files) {
    if (references.length >= maxRefs) break;

    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (references.length >= maxRefs) break;

      const line = lines[i];
      if (line === undefined) continue;

      if (typeRegex.test(line)) {
        const relFile = relative(args.project_root, file);
        references.push({
          file: relFile,
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  if (references.length === 0) {
    return `No references found for type "${args.type_name}".`;
  }

  const header = `Found ${references.length} reference${references.length > 1 ? 's' : ''} to "${args.type_name}":\n`;
  const body = references
    .map((r) => `  ${r.file}:${r.line}: ${r.text}`)
    .join('\n');
  return header + body;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
