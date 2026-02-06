import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolServerError } from '../../src/errors.js';
import { ToolRegistry } from '../../src/host/tool-registry.js';
import type { StdioTransport } from '../../src/host/transport.js';

/**
 * Create a mock StdioTransport that returns predetermined responses.
 */
function createMockTransport(toolsList: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>): StdioTransport {
  return {
    request: vi.fn().mockImplementation(async (method: string) => {
      if (method === 'tools/list') {
        return { tools: toolsList };
      }
      if (method === 'tools/call') {
        return {
          content: [{ type: 'text', text: 'mock response' }],
        };
      }
      return {};
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as StdioTransport;
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerToolManually', () => {
    it('registers tools manually for testing', () => {
      registry.registerToolManually('test-server', {
        name: 'my_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
      });

      const tools = registry.getAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('my_tool');
    });

    it('groups tools under the same server', () => {
      registry.registerToolManually('test-server', {
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: {},
      });
      registry.registerToolManually('test-server', {
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: {},
      });

      expect(registry.getAvailableTools()).toHaveLength(2);
    });
  });

  describe('registerServer', () => {
    it('discovers tools from transport via tools/list', async () => {
      const transport = createMockTransport([
        { name: 'get_diff', description: 'Get diff', inputSchema: { type: 'object' } },
        { name: 'get_stats', description: 'Get stats', inputSchema: { type: 'object' } },
      ]);

      await registry.registerServer('git-diff', transport);

      const tools = registry.getAvailableTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain('get_diff');
      expect(tools.map((t) => t.name)).toContain('get_stats');
    });

    it('calls tools/list on the transport', async () => {
      const transport = createMockTransport([]);
      await registry.registerServer('empty', transport);

      expect(transport.request).toHaveBeenCalledWith('tools/list', {});
    });
  });

  describe('getAvailableTools', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.getAvailableTools()).toHaveLength(0);
    });

    it('returns tools with name, description, and inputSchema', async () => {
      const transport = createMockTransport([
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ]);

      await registry.registerServer('file-context', transport);

      const tools = registry.getAvailableTools();
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
      }
    });
  });

  describe('callTool', () => {
    it('returns error for unknown tool', async () => {
      const result = await registry.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool');
    });

    it('returns placeholder for manually registered tool (no transport)', async () => {
      registry.registerToolManually('test-server', {
        name: 'my_tool',
        description: 'Test',
        inputSchema: {},
      });

      const result = await registry.callTool({
        name: 'my_tool',
        arguments: { key: 'value' },
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('my_tool');
    });

    it('routes to transport for server-registered tools', async () => {
      const transport = createMockTransport([
        { name: 'get_diff', description: 'Get diff', inputSchema: {} },
      ]);

      await registry.registerServer('git-diff', transport);

      const result = await registry.callTool({
        name: 'get_diff',
        arguments: { range: 'HEAD~1..HEAD' },
      });

      expect(result.content).toBe('mock response');
      expect(result.isError).toBeUndefined();
      expect(transport.request).toHaveBeenCalledWith('tools/call', {
        name: 'get_diff',
        arguments: { range: 'HEAD~1..HEAD' },
      });
    });

    it('throws ToolServerError on transport failure', async () => {
      const transport = createMockTransport([
        { name: 'failing_tool', description: 'Fails', inputSchema: {} },
      ]);
      vi.mocked(transport.request).mockImplementation(async (method: string) => {
        if (method === 'tools/list') {
          return { tools: [{ name: 'failing_tool', description: 'Fails', inputSchema: {} }] };
        }
        throw new Error('Connection lost');
      });

      await registry.registerServer('broken', transport);

      await expect(
        registry.callTool({ name: 'failing_tool', arguments: {} }),
      ).rejects.toThrow(ToolServerError);
    });
  });

  describe('tool result caching', () => {
    it('returns cached result for identical cacheable tool calls', async () => {
      let callCount = 0;
      const transport = {
        request: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'tools/list') {
            return { tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {} }] };
          }
          callCount++;
          return {
            content: [{ type: 'text', text: `response ${callCount}` }],
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as StdioTransport;

      await registry.registerServer('file-context', transport);

      const result1 = await registry.callTool({ name: 'read_file', arguments: { path: '/foo.ts' } });
      const result2 = await registry.callTool({ name: 'read_file', arguments: { path: '/foo.ts' } });

      expect(result1.content).toBe('response 1');
      expect(result2.content).toBe('response 1'); // Same cached result
      expect(callCount).toBe(1); // Transport only called once
    });

    it('does not cache results for different arguments', async () => {
      let callCount = 0;
      const transport = {
        request: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'tools/list') {
            return { tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {} }] };
          }
          callCount++;
          return {
            content: [{ type: 'text', text: `response ${callCount}` }],
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as StdioTransport;

      await registry.registerServer('file-context', transport);

      const result1 = await registry.callTool({ name: 'read_file', arguments: { path: '/foo.ts' } });
      const result2 = await registry.callTool({ name: 'read_file', arguments: { path: '/bar.ts' } });

      expect(result1.content).toBe('response 1');
      expect(result2.content).toBe('response 2');
      expect(callCount).toBe(2);
    });

    it('does not cache non-cacheable tools', async () => {
      let callCount = 0;
      const transport = {
        request: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'tools/list') {
            return { tools: [{ name: 'find_similar_patterns', description: 'Search patterns', inputSchema: {} }] };
          }
          callCount++;
          return {
            content: [{ type: 'text', text: `response ${callCount}` }],
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as StdioTransport;

      await registry.registerServer('conventions', transport);

      const result1 = await registry.callTool({ name: 'find_similar_patterns', arguments: { pattern: 'foo' } });
      const result2 = await registry.callTool({ name: 'find_similar_patterns', arguments: { pattern: 'foo' } });

      expect(result1.content).toBe('response 1');
      expect(result2.content).toBe('response 2');
      expect(callCount).toBe(2);
    });

    it('does not cache error results', async () => {
      let callCount = 0;
      const transport = {
        request: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'tools/list') {
            return { tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {} }] };
          }
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ type: 'text', text: 'error occurred' }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: 'success' }],
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as StdioTransport;

      await registry.registerServer('file-context', transport);

      const result1 = await registry.callTool({ name: 'read_file', arguments: { path: '/fail.ts' } });
      const result2 = await registry.callTool({ name: 'read_file', arguments: { path: '/fail.ts' } });

      expect(result1.isError).toBe(true);
      expect(result2.content).toBe('success');
      expect(callCount).toBe(2); // Called twice because error wasn't cached
    });

    it('clears cache on shutdown', async () => {
      let callCount = 0;
      const transport = {
        request: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'tools/list') {
            return { tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {} }] };
          }
          callCount++;
          return {
            content: [{ type: 'text', text: `response ${callCount}` }],
          };
        }),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as StdioTransport;

      await registry.registerServer('file-context', transport);

      await registry.callTool({ name: 'read_file', arguments: { path: '/foo.ts' } });
      await registry.shutdown();

      // Re-register and call again — should not use old cache
      await registry.registerServer('file-context', transport);
      const result = await registry.callTool({ name: 'read_file', arguments: { path: '/foo.ts' } });

      expect(result.content).toBe('response 2'); // New response, not cached
    });
  });

  describe('shutdown', () => {
    it('clears all registered tools', async () => {
      registry.registerToolManually('test', {
        name: 'tool',
        description: 'test',
        inputSchema: {},
      });

      await registry.shutdown();
      expect(registry.getAvailableTools()).toHaveLength(0);
    });

    it('stops all transports', async () => {
      const transport = createMockTransport([
        { name: 'tool', description: 'test', inputSchema: {} },
      ]);

      await registry.registerServer('server', transport);
      await registry.shutdown();

      expect(transport.stop).toHaveBeenCalled();
    });
  });
});
