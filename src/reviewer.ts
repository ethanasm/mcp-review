import ora from 'ora';
import { simpleGit } from 'simple-git';
import { cacheReview, getCachedReview } from './cache.js';
import type { Config } from './config.js';
import { getDiff, getDiffStats, getStagedDiff, getStagedDiffStats } from './git/commands.js';
import type { ResolvedRange } from './git/resolver.js';
import { MCPHost } from './host/mcp-host.js';
import { debug, setVerbose, timer } from './logger.js';
import { renderReview } from './output.js';

export interface ReviewerOptions extends Config {
  verbose?: boolean;
  outputFormat?: 'terminal' | 'json';
}

export interface ReviewResult {
  critical: ReviewFinding[];
  suggestions: ReviewFinding[];
  positive: ReviewFinding[];
  confidence: 'high' | 'medium' | 'low';
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  tokenUsage?: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

export interface ReviewFinding {
  file: string;
  line?: number;
  endLine?: number;
  message: string;
  suggestion?: string;
}

export interface Reviewer {
  review(range: ResolvedRange): Promise<ReviewResult>;
  watch(): Promise<void>;
}

const WATCH_POLL_INTERVAL_MS = 2000;
const WATCH_DEBOUNCE_MS = 3000;

/**
 * Get the latest commit hash from git log.
 */
export async function getLatestCommitHash(): Promise<string> {
  const git = simpleGit();
  const log = await git.log({ maxCount: 1 });
  const latest = log.latest;
  if (!latest) {
    throw new Error('No commits found in repository');
  }
  return latest.hash;
}

export function createReviewer(options: ReviewerOptions): Reviewer {
  setVerbose(options.verbose ?? false);
  const host = new MCPHost(options);

  return {
    async review(range: ResolvedRange): Promise<ReviewResult> {
      const endTotal = timer('review', 'total review');
      const spinner = ora({ text: 'Starting tool servers...', isSilent: options.outputFormat === 'json' }).start();

      // Initialize MCP servers and fetch diff+stats in parallel
      const endParallelInit = timer('review', 'parallel init + diff fetch');
      const [, diff, stats] = await Promise.all([
        host.initialize(),
        range.type === 'staged'
          ? getStagedDiff()
          : getDiff(range.from!, range.to!),
        range.type === 'staged'
          ? getStagedDiffStats()
          : getDiffStats(range.from!, range.to!),
      ]);
      endParallelInit();

      try {
        // Check cache before running the review
        const cached = await getCachedReview(diff, options, options.model);
        if (cached) {
          spinner.succeed('Review loaded from cache');
          renderReview(cached, options, { fromCache: true });
          endTotal();
          return cached;
        }

        debug('review', `Diff size: ${diff.length} chars, ${stats.filesChanged} files changed`);

        const result = await host.runReview(range, { diff, stats }, spinner);

        // Store result in cache after a successful review
        await cacheReview(diff, options, options.model, result);

        spinner.succeed('Review complete');
        renderReview(result, options);
        endTotal();
        return result;
      } catch (error) {
        spinner.fail('Review failed');
        throw error;
      } finally {
        await host.shutdown();
      }
    },

    async watch(): Promise<void> {
      let lastReviewedHash = await getLatestCommitHash();
      let running = true;

      const spinner = ora('Watching for commits...').start();

      const cleanup = () => {
        running = false;
        spinner.stop();
        console.log('\nStopped watching.');
      };

      process.on('SIGINT', cleanup);

      try {
        while (running) {
          await sleep(WATCH_POLL_INTERVAL_MS);

          if (!running) break;

          const currentHash = await getLatestCommitHash();

          if (currentHash !== lastReviewedHash) {
            spinner.text = 'New commit detected, reviewing...';

            // Debounce: wait before reviewing to allow rapid commits to settle
            await sleep(WATCH_DEBOUNCE_MS);

            if (!running) break;

            // Re-check after debounce in case more commits landed
            const hashAfterDebounce = await getLatestCommitHash();

            const range: ResolvedRange = {
              type: 'range',
              from: `${hashAfterDebounce}~1`,
              to: hashAfterDebounce,
              display: `commit ${hashAfterDebounce.substring(0, 7)}`,
            };

            spinner.stop();

            try {
              const [, diff, stats] = await Promise.all([
                host.initialize(),
                getDiff(range.from!, range.to!),
                getDiffStats(range.from!, range.to!),
              ]);

              const cached = await getCachedReview(diff, options, options.model);
              if (cached) {
                renderReview(cached, options, { fromCache: true });
              } else {
                const reviewSpinner = ora('Analyzing changes...').start();
                const result = await host.runReview(range, { diff, stats }, reviewSpinner);
                await cacheReview(diff, options, options.model, result);
                reviewSpinner.succeed('Review complete');
                renderReview(result, options);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(`Review failed for ${hashAfterDebounce.substring(0, 7)}: ${message}`);
            } finally {
              await host.shutdown();
            }

            lastReviewedHash = hashAfterDebounce;

            if (running) {
              spinner.start('Watching for commits...');
            }
          }
        }
      } finally {
        process.removeListener('SIGINT', cleanup);
        spinner.stop();
        await host.shutdown();
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
