import type { Config } from '../../src/config.js';
import type { DiffStats } from '../../src/git/commands.js';
import type { ReviewFinding, ReviewResult } from '../../src/reviewer.js';

/**
 * Create a mock ReviewResult with sensible defaults.
 * Any field can be overridden via the `overrides` parameter.
 *
 * @example
 * ```ts
 * const result = createMockReviewResult();
 * expect(result.confidence).toBe('high');
 *
 * const lowConfidence = createMockReviewResult({ confidence: 'low' });
 * expect(lowConfidence.confidence).toBe('low');
 * ```
 */
export function createMockReviewResult(overrides?: Partial<ReviewResult>): ReviewResult {
  return {
    critical: [
      createMockFinding({
        file: 'src/debug.ts',
        line: 6,
        message: 'console.log left in production code',
        suggestion: 'Remove or replace with a proper logging framework',
      }),
    ],
    suggestions: [
      createMockFinding({
        file: 'src/debug.ts',
        line: 3,
        message: 'TODO comment should be tracked in an issue tracker',
      }),
    ],
    positive: [
      createMockFinding({
        file: 'src/utils.ts',
        message: 'Clean, well-typed utility functions',
      }),
    ],
    confidence: 'high',
    stats: {
      filesChanged: 3,
      insertions: 15,
      deletions: 2,
    },
    ...overrides,
  };
}

/**
 * Create a mock ReviewFinding with sensible defaults.
 * Any field can be overridden via the `overrides` parameter.
 *
 * @example
 * ```ts
 * const finding = createMockFinding({ line: 42, message: 'Unused variable' });
 * expect(finding.file).toBe('src/example.ts');
 * expect(finding.line).toBe(42);
 * ```
 */
export function createMockFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/example.ts',
    line: 10,
    message: 'Example finding message',
    ...overrides,
  };
}

/**
 * Create a mock DiffStats object with sensible defaults.
 * Any field can be overridden via the `overrides` parameter.
 *
 * @example
 * ```ts
 * const stats = createMockDiffStats({ filesChanged: 1, files: ['README.md'] });
 * expect(stats.insertions).toBe(10);
 * ```
 */
export function createMockDiffStats(overrides?: Partial<DiffStats>): DiffStats {
  return {
    filesChanged: 3,
    insertions: 10,
    deletions: 5,
    files: ['src/utils.ts', 'src/debug.ts', 'src/index.ts'],
    ...overrides,
  };
}

/**
 * Create a mock Config object with sensible defaults.
 * Any field can be overridden via the `overrides` parameter.
 *
 * @example
 * ```ts
 * const config = createMockConfig({ model: 'claude-opus-4-20250514', focus: ['security'] });
 * expect(config.max_files).toBe(20);
 * ```
 */
export function createMockConfig(overrides?: Partial<Config>): Config {
  return {
    model: 'claude-sonnet-4-20250514',
    focus: [],
    ignore: [],
    conventions: [],
    max_files: 20,
    context_lines: 5,
    ...overrides,
  };
}
