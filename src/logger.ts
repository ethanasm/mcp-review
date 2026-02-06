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
