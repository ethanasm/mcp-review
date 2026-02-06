import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleGetCommitMessages,
  handleGetDiff,
  handleGetDiffStats,
} from '../../src/tools/git-diff/handlers.js';

vi.mock('../../src/git/commands.js', () => ({
  getDiff: vi.fn(),
  getDiffStats: vi.fn(),
  getStagedDiff: vi.fn(),
  getStagedDiffStats: vi.fn(),
  getCommitMessages: vi.fn(),
}));

const { getDiff, getDiffStats, getStagedDiff, getStagedDiffStats, getCommitMessages } =
  await import('../../src/git/commands.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleGetDiff', () => {
  it('returns diff for a revision range', async () => {
    vi.mocked(getDiff).mockResolvedValue('diff --git a/foo.ts b/foo.ts\n+line');

    const result = await handleGetDiff({ range: 'HEAD~1..HEAD' });

    expect(result).toContain('diff --git');
    expect(getDiff).toHaveBeenCalledWith('HEAD~1', 'HEAD', {
      file: undefined,
      contextLines: undefined,
    });
  });

  it('returns staged diff when range is "staged"', async () => {
    vi.mocked(getStagedDiff).mockResolvedValue('staged diff content');

    const result = await handleGetDiff({ range: 'staged' });

    expect(result).toBe('staged diff content');
    expect(getStagedDiff).toHaveBeenCalled();
  });

  it('returns no-diff message when diff is empty', async () => {
    vi.mocked(getDiff).mockResolvedValue('');

    const result = await handleGetDiff({ range: 'abc..def' });

    expect(result).toContain('No diff found');
  });

  it('returns no-staged message when staged diff is empty', async () => {
    vi.mocked(getStagedDiff).mockResolvedValue('');

    const result = await handleGetDiff({ range: 'staged' });

    expect(result).toContain('No staged changes');
  });

  it('passes file_path option', async () => {
    vi.mocked(getDiff).mockResolvedValue('file diff');

    await handleGetDiff({ range: 'HEAD~1..HEAD', file_path: 'src/foo.ts' });

    expect(getDiff).toHaveBeenCalledWith('HEAD~1', 'HEAD', {
      file: 'src/foo.ts',
      contextLines: undefined,
    });
  });

  it('passes context_lines option', async () => {
    vi.mocked(getDiff).mockResolvedValue('diff with context');

    await handleGetDiff({ range: 'HEAD~1..HEAD', context_lines: 10 });

    expect(getDiff).toHaveBeenCalledWith('HEAD~1', 'HEAD', {
      file: undefined,
      contextLines: 10,
    });
  });

  it('expands single commit to parent range', async () => {
    vi.mocked(getDiff).mockResolvedValue('single commit diff');

    await handleGetDiff({ range: 'abc123' });

    expect(getDiff).toHaveBeenCalledWith('abc123~1', 'abc123', {
      file: undefined,
      contextLines: undefined,
    });
  });
});

describe('handleGetDiffStats', () => {
  it('returns JSON stats for a range', async () => {
    vi.mocked(getDiffStats).mockResolvedValue({
      filesChanged: 3,
      insertions: 15,
      deletions: 5,
      files: ['a.ts', 'b.ts', 'c.ts'],
    });

    const result = await handleGetDiffStats({ range: 'HEAD~1..HEAD' });
    const parsed = JSON.parse(result);

    expect(parsed.filesChanged).toBe(3);
    expect(parsed.insertions).toBe(15);
    expect(parsed.deletions).toBe(5);
    expect(parsed.files).toHaveLength(3);
  });

  it('returns staged stats when range is "staged"', async () => {
    vi.mocked(getStagedDiffStats).mockResolvedValue({
      filesChanged: 1,
      insertions: 2,
      deletions: 0,
      files: ['staged.ts'],
    });

    const result = await handleGetDiffStats({ range: 'staged' });
    const parsed = JSON.parse(result);

    expect(parsed.filesChanged).toBe(1);
    expect(getStagedDiffStats).toHaveBeenCalled();
  });
});

describe('handleGetCommitMessages', () => {
  it('returns formatted commit messages', async () => {
    vi.mocked(getCommitMessages).mockResolvedValue([
      { hash: 'abc123def456', message: 'feat: add feature', author: 'Test', date: '2024-01-01' },
      { hash: '789012345678', message: 'fix: bug fix', author: 'Test', date: '2024-01-02' },
    ]);

    const result = await handleGetCommitMessages({ range: 'HEAD~2..HEAD' });

    expect(result).toContain('abc123de');
    expect(result).toContain('feat: add feature');
    expect(result).toContain('fix: bug fix');
  });

  it('returns staged message for staged range', async () => {
    const result = await handleGetCommitMessages({ range: 'staged' });

    expect(result).toContain('Staged mode');
    expect(result).toContain('no commits to show');
  });

  it('returns no-commits message for empty range', async () => {
    vi.mocked(getCommitMessages).mockResolvedValue([]);

    const result = await handleGetCommitMessages({ range: 'HEAD~1..HEAD' });

    expect(result).toContain('No commits found');
  });
});
