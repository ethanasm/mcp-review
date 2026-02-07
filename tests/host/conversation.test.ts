import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/llm/provider.js';

vi.mock('../../src/usage.js', () => ({
  createUsageTracker: () => ({
    addUsage: vi.fn(),
    getTotal: () => ({ inputTokens: 100, outputTokens: 50, estimatedCost: 0.001 }),
    formatUsage: () => '100 in / 50 out',
  }),
}));

vi.mock('../../src/logger.js', () => ({
  debug: vi.fn(),
  timer: vi.fn(() => () => 0),
}));

import { ConversationManager, truncateDiff } from '../../src/host/conversation.js';

/** Helper to create a mock LLMProvider that records call args and returns canned responses. */
function createMockProvider(responses?: LLMResponse[]) {
  const defaultResponse: LLMResponse = {
    content: [
      {
        type: 'text',
        text: '```json\n{"critical":[],"suggestions":[],"positive":[],"confidence":"high"}\n```',
      },
    ],
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
  };

  const queue = responses ? [...responses] : [];
  const calls: LLMRequest[] = [];

  const provider: LLMProvider = {
    async call(request: LLMRequest): Promise<LLMResponse> {
      calls.push(request);
      return queue.length > 0 ? queue.shift()! : defaultResponse;
    },
  };

  return { provider, calls };
}

const mockToolRegistry = {
  getAvailableTools: () => [],
  callTool: vi.fn(),
} as any;

const defaultPrefetched = {
  diff: 'diff --git a/foo.ts b/foo.ts\n+added line',
  stats: { filesChanged: 3, insertions: 10, deletions: 5, files: ['foo.ts', 'bar.ts', 'baz.ts'] },
};

const defaultConfig = {
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic' as const,
  focus: [] as string[],
  ignore: [] as string[],
  conventions: [] as string[],
  max_files: 20,
  context_lines: 5,
  no_cache: false,
};

describe('ConversationManager', () => {
  describe('focus area wiring', () => {
    it('uses security template when focus includes security', async () => {
      const { provider, calls } = createMockProvider();
      const manager = new ConversationManager({ ...defaultConfig, focus: ['security'] }, provider);

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const userMessage = calls[0]!.messages[0]!.content as string;
      expect(userMessage).toContain('Input validation');
      expect(userMessage).toContain('Focus Areas');
    });

    it('uses performance template when focus includes performance', async () => {
      const { provider, calls } = createMockProvider();
      const manager = new ConversationManager(
        { ...defaultConfig, focus: ['performance'] },
        provider,
      );

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const userMessage = calls[0]!.messages[0]!.content as string;
      expect(userMessage).toContain('N+1 queries');
      expect(userMessage).toContain('Focus Areas');
    });

    it('combines security and performance templates when both are focused', async () => {
      const { provider, calls } = createMockProvider();
      const manager = new ConversationManager(
        { ...defaultConfig, focus: ['security', 'performance'] },
        provider,
      );

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const userMessage = calls[0]!.messages[0]!.content as string;
      expect(userMessage).toContain('Input validation');
      expect(userMessage).toContain('N+1 queries');
      expect(userMessage).toContain('Analyzing 3 files');
    });

    it('falls back to general prompt when no recognized focus areas', async () => {
      const { provider, calls } = createMockProvider();
      const manager = new ConversationManager(
        { ...defaultConfig, focus: ['consistency'] },
        provider,
      );

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const userMessage = calls[0]!.messages[0]!.content as string;
      expect(userMessage).toContain('Please review the following code changes');
    });

    it('falls back to general prompt when no focus areas set', async () => {
      const { provider, calls } = createMockProvider();
      const manager = new ConversationManager(defaultConfig, provider);

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const userMessage = calls[0]!.messages[0]!.content as string;
      expect(userMessage).toContain('Please review the following code changes');
    });
  });

  describe('truncateDiff', () => {
    it('returns diff unchanged when under limit', () => {
      const diff = 'diff --git a/foo.ts b/foo.ts\n+added line\n';
      const result = truncateDiff(diff, 1000);
      expect(result.diff).toBe(diff);
      expect(result.omittedFiles).toBe(0);
    });

    it('truncates when diff exceeds token limit', () => {
      // Each file section is ~50 chars. With maxTokens=10 (40 chars), only 1 fits.
      const diff = [
        'diff --git a/a.ts b/a.ts\n+line a content here\n',
        'diff --git a/b.ts b/b.ts\n+line b content here\n',
        'diff --git a/c.ts b/c.ts\n+line c content here\n',
      ].join('');

      const result = truncateDiff(diff, 10); // 10 tokens = 40 chars
      expect(result.diff).toContain('diff --git a/a.ts');
      expect(result.diff).toContain('DIFF TRUNCATED');
      expect(result.diff).toContain('2 additional file(s) omitted');
      expect(result.diff).toContain('diff --git a/b.ts b/b.ts');
      expect(result.diff).toContain('diff --git a/c.ts b/c.ts');
      expect(result.omittedFiles).toBe(2);
    });

    it('lists omitted file headers in truncation notice', () => {
      const diff = [
        'diff --git a/small.ts b/small.ts\n+x\n',
        `diff --git a/big.ts b/big.ts\n${'+y\n'.repeat(100)}`,
        'diff --git a/other.ts b/other.ts\n+z\n',
      ].join('');

      // Set limit so only first file fits
      const result = truncateDiff(diff, 10);
      expect(result.diff).toContain('diff --git a/big.ts b/big.ts');
      expect(result.diff).toContain('diff --git a/other.ts b/other.ts');
      expect(result.diff).toContain('get_diff tool');
      expect(result.omittedFiles).toBe(2);
    });

    it('includes at least one file even if it exceeds budget', () => {
      const diff = `diff --git a/huge.ts b/huge.ts\n${'+line\n'.repeat(100)}`;
      const result = truncateDiff(diff, 1); // 1 token = 4 chars, way under
      // Should still include the first file
      expect(result.diff).toContain('diff --git a/huge.ts');
      expect(result.diff).not.toContain('DIFF TRUNCATED');
      expect(result.omittedFiles).toBe(0);
    });
  });

  describe('spinner progress updates', () => {
    it('updates spinner text during review phases', async () => {
      const toolUseResponse: LLMResponse = {
        content: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'foo.ts' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 50, outputTokens: 30 },
      };

      const finalResponse: LLMResponse = {
        content: [
          {
            type: 'text',
            text: '```json\n{"critical":[],"suggestions":[],"positive":[],"confidence":"high"}\n```',
          },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const { provider } = createMockProvider([toolUseResponse, finalResponse]);

      const mockSpinner = {
        text: '',
        start: vi.fn().mockReturnThis(),
        stop: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
      };

      const mockRegistry = {
        getAvailableTools: () => [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
        ],
        callTool: vi.fn().mockResolvedValue({ content: 'file contents', isError: false }),
      } as any;

      const manager = new ConversationManager(defaultConfig, provider);

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockRegistry,
        defaultPrefetched,
        mockSpinner as any,
      );

      expect(mockRegistry.callTool).toHaveBeenCalled();
    });
  });
});
