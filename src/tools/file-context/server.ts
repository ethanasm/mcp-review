import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { handleListDirectory, handleReadFile, handleReadLines } from './handlers.js';

const server = new McpServer(
  { name: 'file-context', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool('read_file', {
  description: 'Read full file contents with line numbers',
  inputSchema: {
    path: z.string().describe('Path to the file'),
  },
}, async (args) => {
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
});

server.registerTool('read_lines', {
  description: 'Read specific line range from a file',
  inputSchema: {
    path: z.string().describe('Path to the file'),
    start_line: z.number().describe('Starting line number'),
    end_line: z.number().describe('Ending line number'),
  },
}, async (args) => {
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
});

server.registerTool('list_directory', {
  description: 'List directory structure (recursive, max depth 3)',
  inputSchema: {
    path: z.string().describe('Path to the directory'),
    max_depth: z.number().optional().describe('Maximum recursion depth (default: 3)'),
  },
}, async (args) => {
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
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in file-context server:', error);
  process.exit(1);
});
