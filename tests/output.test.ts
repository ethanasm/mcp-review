import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderReview } from '../src/output.js';
import type { ReviewResult, ReviewerOptions } from '../src/reviewer.js';

const baseOptions: ReviewerOptions = {
  model: 'claude-sonnet-4-20250514',
  focus: [],
  ignore: [],
  conventions: [],
  max_files: 20,
  context_lines: 5,
  outputFormat: 'terminal',
};

const baseResult: ReviewResult = {
  critical: [],
  suggestions: [],
  positive: [],
  confidence: 'high',
  stats: { filesChanged: 2, insertions: 10, deletions: 3 },
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('renderReview', () => {
  it('outputs JSON when outputFormat is json', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(baseResult, { ...baseOptions, outputFormat: 'json' });

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.confidence).toBe('high');
    expect(parsed.stats.filesChanged).toBe(2);
  });

  it('renders terminal output with header', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(baseResult, baseOptions);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('mcp-review');
  });

  it('renders critical findings when present', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(
      {
        ...baseResult,
        critical: [{ file: 'src/auth.ts', line: 10, message: 'SQL injection risk' }],
      },
      baseOptions,
    );

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('CRITICAL');
    expect(allOutput).toContain('SQL injection risk');
  });

  it('renders suggestions when present', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(
      {
        ...baseResult,
        suggestions: [
          {
            file: 'src/utils.ts',
            line: 5,
            message: 'Consider using map',
            suggestion: 'Use .map() instead of forEach + push',
          },
        ],
      },
      baseOptions,
    );

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('SUGGESTIONS');
    expect(allOutput).toContain('Consider using map');
  });

  it('renders positive feedback when present', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(
      {
        ...baseResult,
        positive: [{ file: 'src/main.ts', message: 'Good error handling' }],
      },
      baseOptions,
    );

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('LOOKS GOOD');
    expect(allOutput).toContain('Good error handling');
  });

  it('renders confidence in summary', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(baseResult, baseOptions);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('high');
  });

  it('displays cache hit message when fromCache is true', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(baseResult, baseOptions, { fromCache: true });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('Cached review (no API call)');
    expect(allOutput).toContain('Usage');
  });

  it('displays token usage when verbose and tokenUsage present', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(
      {
        ...baseResult,
        tokenUsage: { inputTokens: 1234, outputTokens: 567, estimatedCost: 0.01 },
      },
      { ...baseOptions, verbose: true },
    );

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('Usage');
    expect(allOutput).toContain('1,234');
    expect(allOutput).toContain('567');
  });

  it('does not display usage when verbose is false', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(
      {
        ...baseResult,
        tokenUsage: { inputTokens: 1234, outputTokens: 567, estimatedCost: 0.01 },
      },
      { ...baseOptions, verbose: false },
    );

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).not.toContain('Usage');
  });

  it('does not display usage when tokenUsage is undefined', () => {
    const logSpy = vi.spyOn(console, 'log');
    renderReview(baseResult, { ...baseOptions, verbose: true });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).not.toContain('Usage');
  });
});
