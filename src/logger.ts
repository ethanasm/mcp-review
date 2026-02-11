/**
 * Performance logger with timing instrumentation.
 *
 * Enabled via --verbose flag or MCP_REVIEW_DEBUG=true environment variable.
 * All output goes to stderr so it doesn't interfere with JSON output mode.
 */

const isDebug = process.env.MCP_REVIEW_DEBUG === 'true' || process.env.MCP_REVIEW_DEBUG === '1';

let verbose = false;

export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

function isEnabled(): boolean {
  return verbose || isDebug;
}

/**
 * Log a debug message to stderr.
 */
export function debug(label: string, message: string): void {
  if (!isEnabled()) return;
  console.error(`[${label}] ${message}`);
}

/**
 * Start a timer and return a function that logs the elapsed time.
 */
export function timer(label: string, operation: string): () => number {
  const start = performance.now();
  if (isEnabled()) {
    console.error(`[${label}] ⏱ Starting: ${operation}`);
  }
  return () => {
    const elapsed = performance.now() - start;
    if (isEnabled()) {
      console.error(`[${label}] ✓ ${operation} (${elapsed.toFixed(0)}ms)`);
    }
    return elapsed;
  };
}

/**
 * Time an async operation and log the elapsed time.
 */
export async function timeAsync<T>(
  label: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const end = timer(label, operation);
  try {
    const result = await fn();
    end();
    return result;
  } catch (error) {
    const elapsed = performance.now();
    if (isEnabled()) {
      console.error(`[${label}] ✗ ${operation} failed (${elapsed.toFixed(0)}ms)`);
    }
    throw error;
  }
}

/**
 * Log a summary of timing data at the end of a review.
 */
export function logTimingSummary(timings: Record<string, number>): void {
  if (!isEnabled()) return;
  console.error('\n[perf] ─── Timing Summary ───');
  for (const [label, ms] of Object.entries(timings)) {
    console.error(`[perf]   ${label}: ${ms.toFixed(0)}ms`);
  }
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  console.error(`[perf]   Total: ${total.toFixed(0)}ms`);
  console.error('[perf] ────────────────────');
}

interface TurnReportEntry {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  apiTimeMs: number;
  toolTimeMs: number;
  toolResultChars: number;
}

/**
 * Log a per-round performance report at the end of a review.
 *
 * Shows API call time vs tool execution time per round, input token growth,
 * and tool result sizes — everything needed to identify whether context
 * growth is the bottleneck.
 */
export function logPerformanceReport(
  turns: TurnReportEntry[],
  extras: { initialPromptChars: number; totalReviewMs: number },
): void {
  if (!isEnabled()) return;

  const fmt = (n: number) => n.toLocaleString('en-US');
  const estTokens = (chars: number) => Math.ceil(chars / 4);

  console.error('\n[perf] ═══ Performance Report ═══');
  console.error(
    `[perf]   Initial prompt: ~${fmt(estTokens(extras.initialPromptChars))} tokens (${fmt(extras.initialPromptChars)} chars)`,
  );

  let prevInput = 0;
  let totalApiMs = 0;
  let totalToolMs = 0;

  for (const t of turns) {
    const inputGrowth = prevInput > 0 ? ` (+${fmt(t.inputTokens - prevInput)})` : '';
    const toolInfo =
      t.toolTimeMs > 0
        ? ` | Tools=${t.toolTimeMs.toFixed(0)}ms (${fmt(t.toolResultChars)} chars added)`
        : '';
    console.error(
      `[perf]   Turn ${t.turn}: API=${t.apiTimeMs.toFixed(0)}ms | In=${fmt(t.inputTokens)}${inputGrowth} | Out=${fmt(t.outputTokens)}${toolInfo}`,
    );
    prevInput = t.inputTokens;
    totalApiMs += t.apiTimeMs;
    totalToolMs += t.toolTimeMs;
  }

  console.error('[perf]   ───');
  console.error(
    `[perf]   Totals: API=${totalApiMs.toFixed(0)}ms | Tools=${totalToolMs.toFixed(0)}ms | Wall=${extras.totalReviewMs.toFixed(0)}ms`,
  );
  const apiPct =
    extras.totalReviewMs > 0 ? ((totalApiMs / extras.totalReviewMs) * 100).toFixed(0) : '0';
  const toolPct =
    extras.totalReviewMs > 0 ? ((totalToolMs / extras.totalReviewMs) * 100).toFixed(0) : '0';
  console.error(
    `[perf]   Breakdown: API=${apiPct}% | Tools=${toolPct}% | Overhead=${(100 - Number(apiPct) - Number(toolPct)).toFixed(0)}%`,
  );
  console.error('[perf] ═════════════════════════════');
}
