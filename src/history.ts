import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

const HISTORY_FILE = '.mcp-review-history.json';

export interface UsageHistoryEntry {
  timestamp: number;
  range: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  cached: boolean;
}

/**
 * Append a usage history entry to the persistent history log.
 * Creates the file if it doesn't exist; handles corrupted files gracefully.
 */
export async function appendUsageHistory(
  entry: UsageHistoryEntry,
  projectRoot: string = process.cwd(),
): Promise<void> {
  const filePath = join(projectRoot, HISTORY_FILE);

  let history: UsageHistoryEntry[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      history = parsed;
    }
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  history.push(entry);
  await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Read all usage history entries from the persistent log.
 */
export async function getUsageHistory(
  projectRoot: string = process.cwd(),
): Promise<UsageHistoryEntry[]> {
  const filePath = join(projectRoot, HISTORY_FILE);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Format a terminal-friendly usage report from history entries.
 */
export function formatUsageReport(history: UsageHistoryEntry[]): string {
  if (history.length === 0) {
    return 'No usage history found. Run a review first.';
  }

  const totalInput = history.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutput = history.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCost = history.reduce((sum, e) => sum + e.estimatedCost, 0);
  const totalReviews = history.length;
  const cachedReviews = history.filter((e) => e.cached).length;

  const lines: string[] = [];

  lines.push(chalk.bold('Usage Report'));
  lines.push(chalk.gray('── Totals ─────────────────────────────────────────'));
  lines.push(`  Reviews: ${totalReviews} (${cachedReviews} cached)`);
  lines.push(`  Input tokens:  ${totalInput.toLocaleString('en-US')}`);
  lines.push(`  Output tokens: ${totalOutput.toLocaleString('en-US')}`);
  lines.push(`  Estimated cost: ${chalk.cyan(`$${totalCost.toFixed(4)}`)}`);
  lines.push('');

  // Show recent entries (last 10)
  const recent = history.slice(-10);
  lines.push(chalk.gray('── Recent Reviews ─────────────────────────────────'));

  for (const entry of recent) {
    const date = new Date(entry.timestamp).toLocaleString();
    const cost = `$${entry.estimatedCost.toFixed(4)}`;
    const cached = entry.cached ? chalk.green(' (cached)') : '';
    lines.push(`  ${chalk.dim(date)}  ${entry.range}  ${entry.model}  ${cost}${cached}`);
  }

  if (history.length > 10) {
    lines.push(chalk.dim(`  ... and ${history.length - 10} earlier entries`));
  }

  return lines.join('\n');
}
