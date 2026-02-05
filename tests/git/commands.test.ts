import { beforeEach, describe, expect, it, vi } from 'vitest';

const { diffMock, diffSummaryMock, logMock, rawMock } = vi.hoisted(() => ({
  diffMock: vi.fn(),
  diffSummaryMock: vi.fn(),
  logMock: vi.fn(),
  rawMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  simpleGit: () => ({
    diff: diffMock,
    diffSummary: diffSummaryMock,
    log: logMock,
    raw: rawMock,
  }),
}));

import {
  getBlame,
  getCommitMessages,
  getDiff,
  getDiffStats,
  getStagedDiff,
  getStagedDiffStats,
} from '../../src/git/commands.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDiff', () => {
  it('calls git diff with from and to', async () => {
    diffMock.mockResolvedValue('diff output');
    const result = await getDiff('HEAD~1', 'HEAD');
    expect(diffMock).toHaveBeenCalledWith(['HEAD~1', 'HEAD']);
    expect(result).toBe('diff output');
  });

  it('includes context lines when specified', async () => {
    diffMock.mockResolvedValue('');
    await getDiff('HEAD~1', 'HEAD', { contextLines: 10 });
    expect(diffMock).toHaveBeenCalledWith(['-U10', 'HEAD~1', 'HEAD']);
  });

  it('limits to specific file when specified', async () => {
    diffMock.mockResolvedValue('');
    await getDiff('HEAD~1', 'HEAD', { file: 'src/foo.ts' });
    expect(diffMock).toHaveBeenCalledWith(['HEAD~1', 'HEAD', '--', 'src/foo.ts']);
  });
});

describe('getStagedDiff', () => {
  it('calls git diff with --cached', async () => {
    diffMock.mockResolvedValue('staged diff');
    const result = await getStagedDiff();
    expect(diffMock).toHaveBeenCalledWith(['--cached']);
    expect(result).toBe('staged diff');
  });

  it('includes context lines when specified', async () => {
    diffMock.mockResolvedValue('');
    await getStagedDiff({ contextLines: 3 });
    expect(diffMock).toHaveBeenCalledWith(['-U3', '--cached']);
  });
});

describe('getDiffStats', () => {
  it('returns structured diff stats', async () => {
    diffSummaryMock.mockResolvedValue({
      files: [{ file: 'a.ts' }, { file: 'b.ts' }],
      insertions: 10,
      deletions: 5,
    });

    const result = await getDiffStats('HEAD~1', 'HEAD');
    expect(result).toEqual({
      filesChanged: 2,
      insertions: 10,
      deletions: 5,
      files: ['a.ts', 'b.ts'],
    });
  });
});

describe('getStagedDiffStats', () => {
  it('returns stats for staged changes', async () => {
    diffSummaryMock.mockResolvedValue({
      files: [{ file: 'staged.ts' }],
      insertions: 3,
      deletions: 1,
    });

    const result = await getStagedDiffStats();
    expect(diffSummaryMock).toHaveBeenCalledWith(['--cached']);
    expect(result.filesChanged).toBe(1);
  });
});

describe('getCommitMessages', () => {
  it('returns structured commit info', async () => {
    logMock.mockResolvedValue({
      all: [
        { hash: 'abc123', message: 'fix: bug', author_name: 'Alice', date: '2024-01-01' },
        { hash: 'def456', message: 'feat: thing', author_name: 'Bob', date: '2024-01-02' },
      ],
    });

    const result = await getCommitMessages('HEAD~2', 'HEAD');
    expect(result).toEqual([
      { hash: 'abc123', message: 'fix: bug', author: 'Alice', date: '2024-01-01' },
      { hash: 'def456', message: 'feat: thing', author: 'Bob', date: '2024-01-02' },
    ]);
  });
});

describe('getBlame', () => {
  it('parses porcelain blame output', async () => {
    rawMock.mockResolvedValue(
      [
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 1 1 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1704067200',
        'author-tz +0000',
        'committer Alice',
        'committer-mail <alice@example.com>',
        'committer-time 1704067200',
        'committer-tz +0000',
        'summary Initial commit',
        'filename src/foo.ts',
        '\tconst x = 1;',
        '',
      ].join('\n'),
    );

    const result = await getBlame('src/foo.ts', 1, 1);
    expect(rawMock).toHaveBeenCalledWith(['blame', '-L', '1,1', '--porcelain', 'src/foo.ts']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      line: 1,
      hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      author: 'Alice',
      content: 'const x = 1;',
    });
  });
});
