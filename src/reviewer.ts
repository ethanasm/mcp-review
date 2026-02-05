import type { Config } from './config.js';
import type { ResolvedRange } from './git/resolver.js';
import { MCPHost } from './host/mcp-host.js';
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

export function createReviewer(options: ReviewerOptions): Reviewer {
  const host = new MCPHost(options);

  return {
    async review(range: ResolvedRange): Promise<ReviewResult> {
      // TODO: Implement full review flow
      // 1. Start MCP tool servers
      // 2. Get diff for range
      // 3. Construct initial prompt
      // 4. Send to Claude API with tool descriptions
      // 5. Handle tool calls in a loop
      // 6. Parse structured output
      // 7. Render to terminal

      await host.initialize();

      try {
        const result = await host.runReview(range);
        renderReview(result, options);
        return result;
      } finally {
        await host.shutdown();
      }
    },

    async watch(): Promise<void> {
      // TODO: Implement watch mode
      // 1. Monitor for new commits
      // 2. On new commit, run review
      // 3. Display results
      // 4. Continue watching
      throw new Error('Watch mode not yet implemented');
    },
  };
}
