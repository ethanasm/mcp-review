import boxen from 'boxen';
import chalk from 'chalk';
import type { ReviewFinding, ReviewResult, ReviewerOptions } from './reviewer.js';
import { createUsageTracker } from './usage.js';

export interface RenderOptions {
  fromCache?: boolean;
}

export function renderReview(
  result: ReviewResult,
  options: ReviewerOptions,
  renderOpts: RenderOptions = {},
): void {
  if (options.outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Header box
  const header = boxen(
    `${chalk.bold('mcp-review')}  ·  ${result.stats.filesChanged} files changed  ·  ${chalk.green(`+${result.stats.insertions}`)} ${chalk.red(`-${result.stats.deletions}`)}`,
    {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderStyle: 'round',
      borderColor: 'gray',
    },
  );
  console.log(header);
  console.log();

  // Critical findings
  if (result.critical.length > 0) {
    console.log(chalk.red.bold(`🔴 CRITICAL (${result.critical.length})`));
    for (const finding of result.critical) {
      renderFinding(finding, 'critical');
    }
    console.log();
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    console.log(chalk.yellow.bold(`🟡 SUGGESTIONS (${result.suggestions.length})`));
    for (const finding of result.suggestions) {
      renderFinding(finding, 'suggestion');
    }
    console.log();
  }

  // Positive feedback
  if (result.positive.length > 0) {
    console.log(chalk.green.bold('🟢 LOOKS GOOD'));
    for (const finding of result.positive) {
      renderFinding(finding, 'positive');
    }
    console.log();
  }

  // Summary
  console.log(chalk.gray('── Summary ─────────────────────────────────────────'));
  const summary = [
    result.critical.length > 0 ? `${result.critical.length} critical` : null,
    result.suggestions.length > 0 ? `${result.suggestions.length} suggestions` : null,
    result.positive.length > 0 ? `${result.positive.length} positive` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`  ${summary}`);
  console.log(`  Estimated review confidence: ${chalk.cyan(result.confidence)}`);

  // Usage / cache info
  if (renderOpts.fromCache) {
    console.log();
    console.log(chalk.gray('── Usage ───────────────────────────────────────────'));
    console.log(`  ${chalk.green('Cached review (no API call)')}`);
  } else if (options.verbose && result.tokenUsage) {
    console.log();
    console.log(chalk.gray('── Usage ───────────────────────────────────────────'));
    const tracker = createUsageTracker(options.model);
    tracker.addUsage(result.tokenUsage.inputTokens, result.tokenUsage.outputTokens);
    console.log(`  ${tracker.formatUsage()}`);
  }
}

function renderFinding(finding: ReviewFinding, type: 'critical' | 'suggestion' | 'positive'): void {
  const location = finding.line
    ? finding.endLine
      ? `${finding.file}:${finding.line}-${finding.endLine}`
      : `${finding.file}:${finding.line}`
    : finding.file;

  const locationColor =
    type === 'critical' ? chalk.red : type === 'suggestion' ? chalk.yellow : chalk.green;

  console.log(`  ${locationColor(location)}`);
  console.log(`  ${finding.message}`);
  if (finding.suggestion) {
    console.log(`  ${chalk.gray(finding.suggestion)}`);
  }
  console.log();
}
