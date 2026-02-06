import { readFile as fsReadFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

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
