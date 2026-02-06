#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import { loadConfig } from './config.js';
import { resolve } from './git/resolver.js';
import { formatUsageReport, getUsageHistory } from './history.js';
import { createReviewer } from './reviewer.js';

// Load environment variables
config();

const program = new Command();

program
  .name('mcp-review')
  .description('Context-aware, AI-powered code review at the commit level')
  .version('0.1.0')
  .argument('[range]', 'Git revision range to review (e.g., HEAD~1..HEAD, abc123)')
  .option('--staged', 'Review staged changes (pre-commit mode)')
  .option('--last <n>', 'Review the last N commits', Number.parseInt)
  .option('--since <date>', 'Review commits since date (e.g., "yesterday", "2024-01-01")')
  .option('--focus <areas>', 'Focus areas: security, performance, consistency (comma-separated)')
  .option('--watch', 'Watch mode - review each commit as it happens')
  .option('--model <model>', 'Claude model to use')
  .option('--output <format>', 'Output format: terminal, json', 'terminal')
  .option('--verbose', 'Enable verbose output')
  .option('--usage-report', 'Display usage history and cost summary')
  .action(async (range: string | undefined, options) => {
    try {
      // Handle usage report (no review needed)
      if (options.usageReport) {
        const history = await getUsageHistory();
        console.log(formatUsageReport(history));
        return;
      }

      // Load project configuration
      const projectConfig = await loadConfig();

      // Resolve the git range from user input
      const resolvedRange = await resolve({
        range,
        staged: options.staged,
        last: options.last,
        since: options.since,
      });

      // Create and run the reviewer
      const reviewer = createReviewer({
        ...projectConfig,
        model: options.model ?? projectConfig.model,
        focus: options.focus?.split(',') ?? projectConfig.focus,
        verbose: options.verbose,
        outputFormat: options.output,
      });

      if (options.watch) {
        await reviewer.watch();
      } else {
        const result = await reviewer.review(resolvedRange);
        // Exit 1 if there are critical findings (for CI usage)
        if (result.critical.length > 0) {
          process.exit(1);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      // Exit 2 for errors (distinguishable from critical findings exit code 1)
      process.exit(2);
    }
  });

program.parse();
