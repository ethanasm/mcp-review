import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleGetFileContext,
  handleListDirectory,
  handleReadFile,
  handleReadLines,
} from './handlers.js';

const server = new McpServer(
  { name: 'file-context', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool(
  'read_file',
  {
    description: 'Read full file contents with line numbers',
    inputSchema: {
      path: z.string().describe('Path to the file'),
    },
  },
  async (args) => {
    try {
      const text = await handleReadFile(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error reading file: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'read_lines',
  {
    description: 'Read specific line range from a file',
    inputSchema: {
      path: z.string().describe('Path to the file'),
      start_line: z.number().describe('Starting line number'),
      end_line: z.number().describe('Ending line number'),
    },
  },
  async (args) => {
    try {
      const text = await handleReadLines(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error reading lines: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'list_directory',
  {
    description: 'List directory structure (recursive, max depth 3)',
    inputSchema: {
      path: z.string().describe('Path to the directory'),
      max_depth: z.number().optional().describe('Maximum recursion depth (default: 3)'),
    },
  },
  async (args) => {
    try {
      const text = await handleListDirectory(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error listing directory: ${message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'get_file_context',
  {
    description:
      'Read a file with line numbers, extract its exports, and optionally find importers — all in one call',
    inputSchema: {
      path: z.string().describe('Path to the file'),
      project_root: z
        .string()
        .optional()
        .describe('Absolute path to the project root (needed for importer search)'),
      include_importers: z
        .boolean()
        .optional()
        .describe('Whether to search for files that import this file (default: false)'),
    },
  },
  async (args) => {
    try {
      const text = await handleGetFileContext(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error getting file context: ${message}` }],
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
  console.error('Fatal error in file-context server:', error);
  process.exit(1);
});
