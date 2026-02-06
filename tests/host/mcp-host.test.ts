import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the logger
vi.mock('../../src/logger.js', () => ({
  debug: vi.fn(),
  timer: vi.fn(() => () => 0),
  setVerbose: vi.fn(),
}));

// Mock the StdioTransport
const mockTransport = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue({}),
  notify: vi.fn(),
  on: vi.fn(),
};

vi.mock('../../src/host/transport.js', () => ({
  StdioTransport: vi.fn(() => ({ ...mockTransport })),
}));

// Mock the ConversationManager
const mockRunReview = vi.fn().mockResolvedValue({
  critical: [],
  suggestions: [],
  positive: [],
  confidence: 'high',
  stats: { filesChanged: 1, insertions: 5, deletions: 2 },
});

vi.mock('../../src/host/conversation.js', () => ({
  ConversationManager: vi.fn(() => ({
    runReview: mockRunReview,
  })),
}));

import { MCPHost } from '../../src/host/mcp-host.js';
import { StdioTransport } from '../../src/host/transport.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the mock transport for each instance
  mockTransport.start.mockResolvedValue(undefined);
  mockTransport.stop.mockResolvedValue(undefined);
  mockTransport.request.mockResolvedValue({ tools: [] });
  mockTransport.notify.mockReset();
});

const defaultOptions = {
  model: 'claude-sonnet-4-20250514',
  focus: [],
  ignore: [],
  conventions: [],
  max_files: 20,
  context_lines: 5,
  no_cache: false,
};

describe('MCPHost', () => {
  describe('initialize', () => {
    it('spawns tool server transports', async () => {
      const host = new MCPHost(defaultOptions);
      await host.initialize();

      // Should create 4 transports (git-diff, file-context, conventions, related-files)
      expect(StdioTransport).toHaveBeenCalledTimes(4);
    });

    it('sends initialize and notifications/initialized to each server', async () => {
      const host = new MCPHost(defaultOptions);
      await host.initialize();

      // Each server gets: start(), request('initialize'), notify('notifications/initialized'), request('tools/list')
      // 4 servers * 2 requests = 8 request calls
      const requestCalls = mockTransport.request.mock.calls;
      const initCalls = requestCalls.filter(
        (c: unknown[]) => c[0] === 'initialize',
      );
      expect(initCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('is idempotent', async () => {
      const host = new MCPHost(defaultOptions);
      await host.initialize();
      await host.initialize();

      // Should only create transports once
      expect(StdioTransport).toHaveBeenCalledTimes(4);
    });

    it('continues when a server fails to start', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTransport.start.mockRejectedValueOnce(new Error('spawn failed'));

      const host = new MCPHost(defaultOptions);
      await host.initialize();

      // Should have attempted all 4 servers
      expect(StdioTransport).toHaveBeenCalledTimes(4);
      // Should have logged a warning
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to start'),
      );

      spy.mockRestore();
    });

    it('logs server names via debug logger', async () => {
      const { debug: mockDebug } = await import('../../src/logger.js');

      const host = new MCPHost(defaultOptions);
      await host.initialize();

      expect(mockDebug).toHaveBeenCalledWith('mcp-host', expect.stringContaining('Started server:'));
    });
  });

  describe('runReview', () => {
    const prefetched = {
      diff: 'mock diff',
      stats: { filesChanged: 1, insertions: 5, deletions: 2, files: ['test.ts'] },
    };

    it('throws if not initialized', async () => {
      const host = new MCPHost(defaultOptions);

      await expect(
        host.runReview({ type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' }, prefetched),
      ).rejects.toThrow('not initialized');
    });

    it('delegates to conversation manager', async () => {
      const host = new MCPHost(defaultOptions);
      await host.initialize();

      const result = await host.runReview(
        { type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' },
        prefetched,
      );

      expect(result).toBeDefined();
      expect(result.confidence).toBe('high');
      expect(mockRunReview).toHaveBeenCalled();
    });
  });

  describe('token budget', () => {
    it('starts with full budget', () => {
      const host = new MCPHost(defaultOptions);
      expect(host.getTokenBudgetRemaining()).toBe(100_000);
    });

    it('tracks token usage', () => {
      const host = new MCPHost(defaultOptions);
      // 400 chars ~ 100 tokens at 4 chars/token
      host.addTokenUsage('x'.repeat(400));
      expect(host.getTokenBudgetRemaining()).toBe(99_900);
    });

    it('reports low budget when < 20% remaining', () => {
      const host = new MCPHost(defaultOptions);
      expect(host.isTokenBudgetLow()).toBe(false);

      // Use 85% of budget: 85000 tokens * 4 chars = 340000 chars
      host.addTokenUsage('x'.repeat(340_000));
      expect(host.isTokenBudgetLow()).toBe(true);
    });

    it('does not go below zero', () => {
      const host = new MCPHost(defaultOptions);
      host.addTokenUsage('x'.repeat(1_000_000));
      expect(host.getTokenBudgetRemaining()).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('resets initialized state', async () => {
      const host = new MCPHost(defaultOptions);
      await host.initialize();
      await host.shutdown();

      // Should throw because it's no longer initialized
      await expect(
        host.runReview({ type: 'range', from: 'HEAD~1', to: 'HEAD', display: 'test' }, { diff: '', stats: { filesChanged: 0, insertions: 0, deletions: 0, files: [] } }),
      ).rejects.toThrow('not initialized');
    });

    it('resets token usage', async () => {
      const host = new MCPHost(defaultOptions);
      host.addTokenUsage('x'.repeat(400));
      await host.shutdown();
      expect(host.getTokenBudgetRemaining()).toBe(100_000);
    });
  });
});
