import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('chalk', () => {
  const identity = (s: string) => s;
  const handler: ProxyHandler<typeof identity> = {
    get: (_target, _prop) => identity,
    apply: (_target, _thisArg, args: [string]) => args[0],
  };
  const chainable = new Proxy(identity, handler);
  return {
    default: new Proxy(
      { dim: identity, gray: identity, bold: identity, cyan: identity, green: identity },
      { get: (_target, _prop) => chainable },
    ),
  };
});

const { readFile, writeFile } = await import('node:fs/promises');

import {
  appendUsageHistory,
  formatUsageReport,
  getUsageHistory,
  type UsageHistoryEntry,
} from '../src/history.js';

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleEntry: UsageHistoryEntry = {
  timestamp: 1700000000000,
  range: 'HEAD~1..HEAD',
  model: 'claude-sonnet-4-20250514',
  inputTokens: 1000,
  outputTokens: 500,
  estimatedCost: 0.0105,
  cached: false,
};

describe('appendUsageHistory', () => {
  it('creates history file when it does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await appendUsageHistory(sampleEntry, '/project');

    expect(writeFile).toHaveBeenCalledOnce();
    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].range).toBe('HEAD~1..HEAD');
  });

  it('appends to existing history', async () => {
    const existing: UsageHistoryEntry[] = [
      { timestamp: 1, range: 'old', model: 'm', inputTokens: 0, outputTokens: 0, estimatedCost: 0, cached: false },
    ];
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await appendUsageHistory(
      { timestamp: 2, range: 'new', model: 'm', inputTokens: 100, outputTokens: 50, estimatedCost: 0.005, cached: false },
      '/project',
    );

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(written).toHaveLength(2);
    expect(written[1].range).toBe('new');
  });

  it('handles corrupted history file gracefully', async () => {
    vi.mocked(readFile).mockResolvedValue('not valid json');
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await appendUsageHistory(
      { timestamp: 1, range: 'test', model: 'm', inputTokens: 0, outputTokens: 0, estimatedCost: 0, cached: true },
      '/project',
    );

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(written).toHaveLength(1);
  });

  it('handles non-array JSON in history file', async () => {
    vi.mocked(readFile).mockResolvedValue('{"key": "value"}');
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await appendUsageHistory(sampleEntry, '/project');

    const written = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(written).toHaveLength(1);
  });
});

describe('getUsageHistory', () => {
  it('returns empty array when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const history = await getUsageHistory('/project');

    expect(history).toEqual([]);
  });

  it('returns parsed history entries', async () => {
    const data: UsageHistoryEntry[] = [sampleEntry];
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(data));

    const history = await getUsageHistory('/project');

    expect(history).toHaveLength(1);
    expect(history[0]!.inputTokens).toBe(1000);
    expect(history[0]!.range).toBe('HEAD~1..HEAD');
  });

  it('returns empty array for corrupted file', async () => {
    vi.mocked(readFile).mockResolvedValue('not json');

    const history = await getUsageHistory('/project');

    expect(history).toEqual([]);
  });
});

describe('formatUsageReport', () => {
  it('returns message when no history', () => {
    const report = formatUsageReport([]);

    expect(report).toContain('No usage history');
  });

  it('shows totals and recent entries', () => {
    const entries: UsageHistoryEntry[] = [
      { ...sampleEntry },
      { timestamp: 1700000001000, range: 'staged changes', model: 'claude-sonnet-4-20250514', inputTokens: 0, outputTokens: 0, estimatedCost: 0, cached: true },
    ];

    const report = formatUsageReport(entries);

    expect(report).toContain('Reviews: 2');
    expect(report).toContain('1 cached');
    expect(report).toContain('1,000');
    expect(report).toContain('HEAD~1..HEAD');
    expect(report).toContain('staged changes');
  });

  it('shows correct cost total', () => {
    const entries: UsageHistoryEntry[] = [
      { ...sampleEntry, estimatedCost: 0.10 },
      { ...sampleEntry, estimatedCost: 0.25 },
    ];

    const report = formatUsageReport(entries);

    expect(report).toContain('$0.3500');
  });

  it('truncates to last 10 entries in recent section', () => {
    const entries: UsageHistoryEntry[] = Array.from({ length: 15 }, (_, i) => ({
      timestamp: 1700000000000 + i * 1000,
      range: `range-${i}`,
      model: 'claude-sonnet-4-20250514',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCost: 0.001,
      cached: false,
    }));

    const report = formatUsageReport(entries);

    expect(report).toContain('5 earlier entries');
    expect(report).toContain('range-14'); // most recent
    expect(report).not.toContain('range-0'); // oldest, truncated from recent section
  });
});
