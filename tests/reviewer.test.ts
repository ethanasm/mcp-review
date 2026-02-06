import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock simple-git before importing the module under test
vi.mock('simple-git', () => {
  const mockLog = vi.fn();
  return {
    simpleGit: () => ({
      log: mockLog,
    }),
    __mockLog: mockLog,
  };
});

// Mock logger
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  timer: vi.fn(() => () => 0),
  setVerbose: vi.fn(),
}));

// Mock ora
vi.mock('ora', () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  };
  return {
    default: vi.fn(() => mockSpinner),
  };
});

// Mock the cache module
vi.mock('../src/cache.js', () => ({
  getCachedReview: vi.fn().mockResolvedValue(null),
  cacheReview: vi.fn().mockResolvedValue(undefined),
}));

// Mock git commands
vi.mock('../src/git/commands.js', () => ({
  getDiff: vi.fn().mockResolvedValue('mock diff'),
  getStagedDiff: vi.fn().mockResolvedValue('mock staged diff'),
  getDiffStats: vi.fn().mockResolvedValue({
    filesChanged: 2,
    insertions: 10,
    deletions: 5,
    files: ['a.ts', 'b.ts'],
  }),
  getStagedDiffStats: vi.fn().mockResolvedValue({
    filesChanged: 1,
    insertions: 3,
    deletions: 1,
    files: ['c.ts'],
  }),
  getCommitMessages: vi.fn().mockResolvedValue([]),
}));

// Mock output
vi.mock('../src/output.js', () => ({
  renderReview: vi.fn(),
}));

// Mock the MCPHost
vi.mock('../src/host/mcp-host.js', () => {
  const mockHost = {
    initialize: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue({
      critical: [],
      suggestions: [],
      positive: [{ file: 'test.ts', message: 'Good code' }],
      confidence: 'high',
      stats: { filesChanged: 1, insertions: 5, deletions: 2 },
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return {
    MCPHost: vi.fn(() => mockHost),
  };
});

const { __mockLog } = await import('simple-git');
const mockLog = __mockLog as ReturnType<typeof vi.fn>;

import { getLatestCommitHash } from '../src/reviewer.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getLatestCommitHash', () => {
  it('returns the latest commit hash', async () => {
    mockLog.mockResolvedValueOnce({
      latest: { hash: 'abc123def456' },
      all: [{ hash: 'abc123def456' }],
    });

    const hash = await getLatestCommitHash();
    expect(hash).toBe('abc123def456');
    expect(mockLog).toHaveBeenCalledWith({ maxCount: 1 });
  });

  it('throws when no commits found', async () => {
    mockLog.mockResolvedValueOnce({
      latest: null,
      all: [],
    });

    await expect(getLatestCommitHash()).rejects.toThrow('No commits found in repository');
  });
});

describe('createReviewer', () => {
  // We dynamically import to ensure mocks are in place
  it('review method returns result with spinner integration', async () => {
    const { createReviewer } = await import('../src/reviewer.js');
    const reviewer = createReviewer({
      model: 'claude-sonnet-4-20250514',
      focus: [],
      ignore: [],
      conventions: [],
      max_files: 20,
      context_lines: 5,
      no_cache: false,
      outputFormat: 'terminal',
    });

    const result = await reviewer.review({
      type: 'range',
      from: 'HEAD~1',
      to: 'HEAD',
      display: 'last commit',
    });

    expect(result).toBeDefined();
    expect(result.positive).toHaveLength(1);
  });
});
