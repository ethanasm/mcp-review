import { beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/host/tool-registry.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(async () => {
    registry = new ToolRegistry();
    await registry.initialize();
  });

  describe('initialize', () => {
    it('registers git-diff tools', () => {
      const tools = registry.getAvailableTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('get_diff');
      expect(names).toContain('get_diff_stats');
      expect(names).toContain('get_commit_messages');
    });

    it('registers file-context tools', () => {
      const tools = registry.getAvailableTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('read_file');
      expect(names).toContain('read_lines');
    });

    it('registers 5 tools total', () => {
      expect(registry.getAvailableTools()).toHaveLength(5);
    });
  });

  describe('getAvailableTools', () => {
    it('returns tools with name, description, and inputSchema', () => {
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

    it('returns placeholder for known tool', async () => {
      const result = await registry.callTool({
        name: 'get_diff',
        arguments: { range: 'HEAD~1..HEAD' },
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('get_diff');
    });
  });

  describe('shutdown', () => {
    it('clears all registered tools', async () => {
      await registry.shutdown();
      expect(registry.getAvailableTools()).toHaveLength(0);
    });
  });
});
