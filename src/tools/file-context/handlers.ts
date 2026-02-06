import { readFile as fsReadFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export interface ReadFileArgs {
  path: string;
}

export interface ReadLinesArgs {
  path: string;
  start_line: number;
  end_line: number;
}

export interface ListDirectoryArgs {
  path: string;
  max_depth?: number;
}

/**
 * Handle read_file tool call.
 * Read full file contents and add line numbers.
 */
export async function handleReadFile(args: ReadFileArgs): Promise<string> {
  const content = await fsReadFile(args.path, 'utf-8');
  const lines = content.split('\n');

  return lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
}

/**
 * Handle read_lines tool call.
 * Read a specific line range from a file.
 */
export async function handleReadLines(args: ReadLinesArgs): Promise<string> {
  const content = await fsReadFile(args.path, 'utf-8');
  const lines = content.split('\n');

  const startIdx = Math.max(0, args.start_line - 1);
  const endIdx = Math.min(lines.length, args.end_line);

  if (startIdx >= lines.length) {
    return `File has ${lines.length} lines; requested start_line ${args.start_line} is out of range.`;
  }

  const selected = lines.slice(startIdx, endIdx);
  return selected
    .map((line, i) => `${String(startIdx + i + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
  children?: TreeEntry[];
}

/**
 * Recursively build a directory tree, respecting max depth.
 */
async function buildTree(dirPath: string, currentDepth: number, maxDepth: number): Promise<TreeEntry[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: TreeEntry[] = [];

  // Sort entries: directories first, then files, both alphabetical
  const sorted = entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, currentDepth + 1, maxDepth);
      result.push({ name: entry.name, type: 'directory', children });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, type: 'file' });
    }
  }

  return result;
}

/**
 * Format tree entries into a readable string with indentation.
 */
function formatTree(entries: TreeEntry[], indent: string = ''): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type === 'directory') {
      lines.push(`${indent}${entry.name}/`);
      if (entry.children && entry.children.length > 0) {
        lines.push(formatTree(entry.children, `${indent}  `));
      }
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Handle list_directory tool call.
 * List directory tree, recursive up to max_depth (default 3).
 */
export async function handleListDirectory(args: ListDirectoryArgs): Promise<string> {
  const maxDepth = args.max_depth ?? 3;

  // Verify the path is a directory
  const stats = await stat(args.path);
  if (!stats.isDirectory()) {
    return `Error: ${args.path} is not a directory.`;
  }

  const tree = await buildTree(args.path, 0, maxDepth);
  const baseName = relative(process.cwd(), args.path) || args.path;

  return `${baseName}/\n${formatTree(tree, '  ')}`;
}

export interface GetFileContextArgs {
  path: string;
  project_root?: string;
  include_importers?: boolean;
}

/**
 * Handle get_file_context tool call.
 * Composite tool that reads a file's contents, extracts exports, and
 * optionally finds importers — all in a single tool call.
 * This reduces the number of LLM round-trips needed.
 */
export async function handleGetFileContext(args: GetFileContextArgs): Promise<string> {
  const sections: string[] = [];

  // 1. Read the file content with line numbers
  const content = await fsReadFile(args.path, 'utf-8');
  const lines = content.split('\n');
  const numbered = lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
  sections.push(`## File Contents\n${numbered}`);

  // 2. Extract exports
  const exports: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();

    if (/^export\s+/.test(trimmed)) {
      exports.push(`  L${i + 1}: ${trimmed}`);
    }
  }

  if (exports.length > 0) {
    sections.push(`## Exports (${exports.length})\n${exports.join('\n')}`);
  }

  // 3. Optionally find importers
  if (args.include_importers && args.project_root) {
    const importers = await findImportersSimple(args.path, args.project_root);
    if (importers.length > 0) {
      const importerLines = importers.map((m) => `  ${m.file}:${m.line}: ${m.statement}`);
      sections.push(`## Imported By (${importers.length})\n${importerLines.join('\n')}`);
    } else {
      sections.push('## Imported By\nNo importers found.');
    }
  }

  return sections.join('\n\n');
}

/**
 * Simplified importer finder for the composite tool.
 * Scans source files in the project to find import statements referencing the target.
 */
const IMPORTER_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']);
const IMPORTER_SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', 'build']);

async function findImportersSimple(
  filePath: string,
  projectRoot: string,
): Promise<{ file: string; line: number; statement: string }[]> {
  const relTarget = relative(projectRoot, resolve(filePath));
  const ext = extname(relTarget);
  const targetNoExt = relTarget.slice(0, -ext.length);
  const targetBase = basename(targetNoExt);

  // Build match targets
  const targets = [targetNoExt, `${targetNoExt}.js`, `${targetNoExt}.ts`];
  if (targetBase === 'index') {
    targets.push(dirname(targetNoExt));
  }

  const sourceFiles = await collectSourceFilesForImporters(projectRoot, 300);
  const matches: { file: string; line: number; statement: string }[] = [];
  const importRegex = /(?:import\s+.*?from\s+['"](.+?)['"]|import\s*\(\s*['"](.+?)['"]\s*\)|require\s*\(\s*['"](.+?)['"]\s*\))/g;

  for (const sf of sourceFiles) {
    if (matches.length >= 30) break;
    if (resolve(sf) === resolve(filePath)) continue;

    let sfContent: string;
    try {
      sfContent = await fsReadFile(sf, 'utf-8');
    } catch {
      continue;
    }

    const sfLines = sfContent.split('\n');
    for (let i = 0; i < sfLines.length; i++) {
      if (matches.length >= 30) break;
      const ln = sfLines[i];
      if (ln === undefined) continue;

      importRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(ln)) !== null) {
        const importPath = m[1] ?? m[2] ?? m[3];
        if (!importPath) continue;

        if (importPath.startsWith('.')) {
          const sourceDir = dirname(sf);
          const resolved = relative(projectRoot, resolve(sourceDir, importPath));
          const resExt = extname(resolved);
          const resolvedNoExt = resExt ? resolved.slice(0, -resExt.length) : resolved;
          if (targets.some((t) => { const tExt = extname(t); const tNoExt = tExt ? t.slice(0, -tExt.length) : t; return resolvedNoExt === tNoExt || resolved === t; })) {
            matches.push({ file: relative(projectRoot, sf), line: i + 1, statement: ln.trim() });
            break;
          }
        } else if (targets.some((t) => t === importPath || t.endsWith(`/${importPath}`))) {
          matches.push({ file: relative(projectRoot, sf), line: i + 1, statement: ln.trim() });
          break;
        }
      }
    }
  }

  return matches;
}

async function collectSourceFilesForImporters(
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
      if (IMPORTER_SKIP_DIRS.has(entry.name)) continue;
      const sub = await collectSourceFilesForImporters(join(dir, entry.name), maxFiles - results.length, depth + 1);
      results.push(...sub);
    } else if (entry.isFile() && IMPORTER_SOURCE_EXTS.has(extname(entry.name))) {
      results.push(join(dir, entry.name));
    }
  }

  return results;
}
