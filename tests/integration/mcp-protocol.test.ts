import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { StdioTransport } from '../../src/host/transport.js';
import { createFixtureRepo, type FixtureRepo } from '../fixtures/setup.js';

/**
 * MCP Protocol Integration Tests
 *
 * Spawns actual tool server processes and verifies the full JSON-RPC
 * round-trip over stdio. These tests exercise the real MCP SDK server
 * and our StdioTransport client together.
 *
 * The server is spawned with `cwd` set to a fixture repo so that
 * git operations (diff, log, etc.) run against known commits.
 */

const SERVER_ENTRY = resolve(__dirname, '../../src/tools/git-diff/server.ts');

describe('MCP Protocol Integration', { timeout: 30000 }, () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await createFixtureRepo({
      commits: [
        {
          message: 'add feature file',
          files: { 'src/feature.ts': 'export const feature = true;\n' },
        },
      ],
    });
  });

  afterAll(async () => {
    await repo.cleanup();
  });

  describe('git-diff server lifecycle', () => {
    let transport: StdioTransport;

    beforeAll(async () => {
      // Spawn the git-diff server with cwd set to the fixture repo
      // so simple-git() picks up the correct working directory
      const tsxBin = resolve(__dirname, '../../node_modules/.bin/tsx');
      transport = new StdioTransport(tsxBin, [SERVER_ENTRY], { cwd: repo.path });

      // Suppress stderr noise (e.g. npx "will be installed" warnings)
      transport.on('error', () => {});

      await transport.start();
    });

    afterAll(async () => {
      await transport.stop();
    });

    it('completes MCP initialize handshake', async () => {
      const result = await transport.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.0.1' },
      });

      expect(result).toBeDefined();
      const initResult = result as {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      };

      expect(initResult.protocolVersion).toBeDefined();
      expect(initResult.serverInfo).toBeDefined();
      expect(initResult.serverInfo.name).toBe('git-diff');
    });

    it('discovers tools via tools/list', async () => {
      const result = await transport.request('tools/list', {});

      expect(result).toBeDefined();
      const listResult = result as { tools: Array<{ name: string; description: string }> };

      expect(listResult.tools).toBeInstanceOf(Array);
      expect(listResult.tools.length).toBeGreaterThanOrEqual(3);

      const toolNames = listResult.tools.map((t) => t.name);
      expect(toolNames).toContain('get_diff');
      expect(toolNames).toContain('get_diff_stats');
      expect(toolNames).toContain('get_commit_messages');
    });

    it('executes get_diff_stats via tools/call', async () => {
      const result = await transport.request('tools/call', {
        name: 'get_diff_stats',
        arguments: { range: 'HEAD~1..HEAD' },
      });

      expect(result).toBeDefined();
      const callResult = result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(callResult.content).toBeInstanceOf(Array);
      expect(callResult.content.length).toBeGreaterThan(0);
      expect(callResult.content[0]!.type).toBe('text');

      // The result should be parseable JSON with diff stats
      const stats = JSON.parse(callResult.content[0]!.text);
      expect(stats).toHaveProperty('filesChanged');
      expect(stats).toHaveProperty('insertions');
      expect(stats).toHaveProperty('deletions');
      expect(stats).toHaveProperty('files');
    });

    it('executes get_diff via tools/call', async () => {
      const result = await transport.request('tools/call', {
        name: 'get_diff',
        arguments: { range: 'HEAD~1..HEAD' },
      });

      expect(result).toBeDefined();
      const callResult = result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(callResult.content).toBeInstanceOf(Array);
      expect(callResult.content[0]!.type).toBe('text');
      // Diff output should contain the added file
      expect(callResult.content[0]!.text).toContain('feature');
    });

    it('executes get_commit_messages via tools/call', async () => {
      const result = await transport.request('tools/call', {
        name: 'get_commit_messages',
        arguments: { range: 'HEAD~1..HEAD' },
      });

      expect(result).toBeDefined();
      const callResult = result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(callResult.content).toBeInstanceOf(Array);
      expect(callResult.content[0]!.type).toBe('text');
      // The fixture repo's second commit message is "add feature file"
      expect(callResult.content[0]!.text).toContain('add feature file');
    });

    it('returns error for unknown tool name', async () => {
      // The MCP SDK should return a JSON-RPC error for an unknown tool
      try {
        const result = await transport.request('tools/call', {
          name: 'nonexistent_tool',
          arguments: {},
        });
        // If we get a result instead of an error, it should indicate an error
        const callResult = result as {
          content?: Array<{ type: string; text: string }>;
          isError?: boolean;
        };
        if (callResult.content) {
          expect(callResult.isError).toBe(true);
        }
      } catch (error) {
        // The server may reject with a JSON-RPC error, which is also acceptable
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
