import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { handleGetCommitMessages, handleGetDiff, handleGetDiffStats } from './handlers.js';

const server = new McpServer(
  { name: 'git-diff', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool(
  'get_diff',
  {
    description: 'Get the full git diff for the review scope',
    inputSchema: {
      range: z.string().describe('Git revision range (e.g. "HEAD~1..HEAD" or "staged")'),
      file_path: z.string().optional().describe('Optional: limit diff to specific file'),
      context_lines: z.number().optional().describe('Context lines around changes'),
    },
  },
  async (args) => {
    try {
      const text = await handleGetDiff(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error getting diff: ${message}` }], isError: true };
    }
  },
);

server.registerTool(
  'get_diff_stats',
  {
    description: 'Get file change summary (files changed, insertions, deletions)',
    inputSchema: {
      range: z.string().describe('Git revision range'),
    },
  },
  async (args) => {
    try {
      const text = await handleGetDiffStats(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error getting diff stats: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'get_commit_messages',
  {
    description: 'Get commit messages in the review range to understand developer intent',
    inputSchema: {
      range: z.string().describe('Git revision range'),
    },
  },
  async (args) => {
    try {
      const text = await handleGetCommitMessages(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error getting commit messages: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in git-diff server:', error);
  process.exit(1);
});
