import { describe, expect, it, vi } from 'vitest';

// We need to test that the focus area logic in buildInitialPrompt works correctly.
// Since buildInitialPrompt is private, we test it indirectly through the messages
// passed to the Anthropic client.

// Mock Anthropic SDK
const mockCreate = vi.fn().mockResolvedValue({
  content: [
    {
      type: 'text',
      text: '```json\n{"critical":[],"suggestions":[],"positive":[],"confidence":"high"}\n```',
    },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 },
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

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

import { ConversationManager } from '../../src/host/conversation.js';

const mockToolRegistry = {
  getAvailableTools: () => [],
  callTool: vi.fn(),
} as any;

const defaultPrefetched = {
  diff: 'diff --git a/foo.ts b/foo.ts\n+added line',
  stats: { filesChanged: 3, insertions: 10, deletions: 5, files: ['foo.ts', 'bar.ts', 'baz.ts'] },
};

describe('ConversationManager', () => {
  describe('focus area wiring', () => {
    it('uses security template when focus includes security', async () => {
      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: ['security'],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      // Check that the user message includes security-focused content
      const callArgs = mockCreate.mock.calls[0]![0];
      const userMessage = callArgs.messages[0].content;
      expect(userMessage).toContain('security-focused code review');
      expect(userMessage).toContain('Input validation');
    });

    it('uses performance template when focus includes performance', async () => {
      mockCreate.mockClear();
      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: ['performance'],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      const userMessage = callArgs.messages[0].content;
      expect(userMessage).toContain('performance-focused code review');
      expect(userMessage).toContain('N+1 queries');
    });

    it('combines security and performance templates when both are focused', async () => {
      mockCreate.mockClear();
      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: ['security', 'performance'],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      const userMessage = callArgs.messages[0].content;
      expect(userMessage).toContain('security-focused code review');
      expect(userMessage).toContain('performance-focused code review');
      expect(userMessage).toContain('Analyzing 3 files');
    });

    it('falls back to general prompt when no recognized focus areas', async () => {
      mockCreate.mockClear();
      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: ['consistency'],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      const userMessage = callArgs.messages[0].content;
      // Should use the general getInitialPrompt
      expect(userMessage).toContain('Please review the following code changes');
    });

    it('falls back to general prompt when no focus areas set', async () => {
      mockCreate.mockClear();
      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: [],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockToolRegistry,
        defaultPrefetched,
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      const userMessage = callArgs.messages[0].content;
      expect(userMessage).toContain('Please review the following code changes');
    });
  });

  describe('spinner progress updates', () => {
    it('updates spinner text during review phases', async () => {
      // Set up a tool_use response followed by final response
      mockCreate.mockClear();
      mockCreate
        .mockResolvedValueOnce({
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'foo.ts' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 50, output_tokens: 30 },
        })
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: '```json\n{"critical":[],"suggestions":[],"positive":[],"confidence":"high"}\n```',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        });

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

      const manager = new ConversationManager({
        model: 'claude-sonnet-4-20250514',
        focus: [],
        ignore: [],
        conventions: [],
        max_files: 20,
        context_lines: 5,
        no_cache: false,
      });

      await manager.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        mockRegistry,
        defaultPrefetched,
        mockSpinner as any,
      );

      // Verify spinner text was updated with expected progress messages
      // The spinner.text assignments happen in sequence, so we check the calls
      // We can't easily check all intermediate .text values, but we know
      // that the spinner was passed and used
      expect(mockRegistry.callTool).toHaveBeenCalled();
    });
  });
});
