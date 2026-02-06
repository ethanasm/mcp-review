import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleListDirectory,
  handleReadFile,
  handleReadLines,
} from '../../src/tools/file-context/handlers.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const { readFile, readdir, stat } = await import('node:fs/promises');

beforeEach(() => {
  vi.clearAllMocks();
});

function mockDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  };
}

describe('handleReadFile', () => {
  it('reads file and adds line numbers', async () => {
    vi.mocked(readFile).mockResolvedValue('line one\nline two\nline three\n');

    const result = await handleReadFile({ path: '/project/src/foo.ts' });

    expect(result).toContain('1 | line one');
    expect(result).toContain('2 | line two');
    expect(result).toContain('3 | line three');
  });

  it('pads line numbers correctly', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    vi.mocked(readFile).mockResolvedValue(lines);

    const result = await handleReadFile({ path: '/project/big.ts' });

    // Line 1 should be padded to match width of line 100
    expect(result).toContain('   1 | line 1');
    expect(result).toContain(' 100 | line 100');
  });
});

describe('handleReadLines', () => {
  it('reads specific line range', async () => {
    vi.mocked(readFile).mockResolvedValue('a\nb\nc\nd\ne\n');

    const result = await handleReadLines({ path: '/project/foo.ts', start_line: 2, end_line: 4 });

    expect(result).toContain('2 | b');
    expect(result).toContain('3 | c');
    expect(result).toContain('4 | d');
    expect(result).not.toContain('1 | a');
    expect(result).not.toContain('5 | e');
  });

  it('handles out-of-range start_line', async () => {
    vi.mocked(readFile).mockResolvedValue('a\nb\n');

    const result = await handleReadLines({ path: '/project/foo.ts', start_line: 100, end_line: 200 });

    expect(result).toContain('out of range');
  });

  it('clamps end_line to file length', async () => {
    vi.mocked(readFile).mockResolvedValue('a\nb\nc\n');

    const result = await handleReadLines({ path: '/project/foo.ts', start_line: 2, end_line: 100 });

    expect(result).toContain('2 | b');
    expect(result).toContain('3 | c');
  });
});

describe('handleListDirectory', () => {
  it('lists directory tree', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(readdir)
      .mockResolvedValueOnce([
        mockDirent('src', true),
        mockDirent('package.json', false),
      ] as never)
      .mockResolvedValueOnce([
        mockDirent('index.ts', false),
      ] as never);

    const result = await handleListDirectory({ path: '/project' });

    expect(result).toContain('src/');
    expect(result).toContain('index.ts');
    expect(result).toContain('package.json');
  });

  it('returns error for non-directory path', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any);

    const result = await handleListDirectory({ path: '/project/file.ts' });

    expect(result).toContain('not a directory');
  });

  it('skips node_modules and dist', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(readdir).mockResolvedValueOnce([
      mockDirent('node_modules', true),
      mockDirent('dist', true),
      mockDirent('src', true),
      mockDirent('.git', true),
    ] as never)
    .mockResolvedValueOnce([] as never); // src contents

    const result = await handleListDirectory({ path: '/project' });

    expect(result).toContain('src/');
    expect(result).not.toContain('node_modules');
    expect(result).not.toContain('dist');
    expect(result).not.toContain('.git');
  });

  it('respects max_depth', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(readdir).mockResolvedValueOnce([
      mockDirent('level0', true),
    ] as never)
    .mockResolvedValueOnce([] as never);

    const result = await handleListDirectory({ path: '/project', max_depth: 1 });

    expect(result).toContain('level0/');
    // With max_depth 1, readdir is called for root only, then stops
  });
});
