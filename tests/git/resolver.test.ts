import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from '../../src/git/resolver.js';

// Mock simple-git
vi.mock('simple-git', () => {
  const logMock = vi.fn();
  const revparseMock = vi.fn();
  return {
    simpleGit: () => ({
      log: logMock,
      revparse: revparseMock,
    }),
    __logMock: logMock,
    __revparseMock: revparseMock,
  };
});

// Access mocks for assertions
const { __logMock: logMock } = await import('simple-git');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolve', () => {
  it('returns staged type for --staged', async () => {
    const result = await resolve({ staged: true });
    expect(result).toEqual({
      type: 'staged',
      display: 'staged changes',
    });
  });

  it('returns range for --last N', async () => {
    const result = await resolve({ last: 3 });
    expect(result).toEqual({
      type: 'range',
      from: 'HEAD~3',
      to: 'HEAD',
      display: 'last 3 commits',
    });
  });

  it('returns range for --since date', async () => {
    (logMock as ReturnType<typeof vi.fn>).mockResolvedValue({
      all: [
        { hash: 'abc123', message: 'recent', author_name: 'a', date: '2024-01-02' },
        { hash: 'def456', message: 'oldest', author_name: 'a', date: '2024-01-01' },
      ],
    });

    const result = await resolve({ since: 'yesterday' });
    expect(result).toEqual({
      type: 'range',
      from: 'def456~1',
      to: 'HEAD',
      display: 'commits since yesterday',
    });
  });

  it('throws when --since finds no commits', async () => {
    (logMock as ReturnType<typeof vi.fn>).mockResolvedValue({ all: [] });

    await expect(resolve({ since: '2099-01-01' })).rejects.toThrow(
      'No commits found since 2099-01-01',
    );
  });

  it('parses explicit range with ..', async () => {
    const result = await resolve({ range: 'abc123..def456' });
    expect(result).toEqual({
      type: 'range',
      from: 'abc123',
      to: 'def456',
      display: 'abc123..def456',
    });
  });

  it('defaults to HEAD when range has no "to"', async () => {
    const result = await resolve({ range: 'abc123..' });
    expect(result).toEqual({
      type: 'range',
      from: 'abc123',
      to: 'HEAD',
      display: 'abc123..',
    });
  });

  it('converts single commit to range', async () => {
    const result = await resolve({ range: 'abc1234' });
    expect(result).toEqual({
      type: 'range',
      from: 'abc1234~1',
      to: 'abc1234',
      display: 'commit abc1234',
    });
  });

  it('defaults to last commit when no options given', async () => {
    const result = await resolve({});
    expect(result).toEqual({
      type: 'range',
      from: 'HEAD~1',
      to: 'HEAD',
      display: 'last commit',
    });
  });

  it('prioritizes --staged over other options', async () => {
    const result = await resolve({ staged: true, last: 3, range: 'abc..def' });
    expect(result.type).toBe('staged');
  });

  it('prioritizes --last over --range', async () => {
    const result = await resolve({ last: 2, range: 'abc..def' });
    expect(result.from).toBe('HEAD~2');
  });
});
