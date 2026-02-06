import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleFindExports,
  handleFindImporters,
  handleFindTestFiles,
  handleFindTypeReferences,
} from './handlers.js';

const server = new McpServer(
  { name: 'related-files', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool('find_importers', {
  description: 'Find files that import or require the given file',
  inputSchema: {
    file_path: z.string().describe('Relative path to the file from project root'),
    project_root: z.string().describe('Absolute path to the project root directory'),
  },
}, async (args) => {
  try {
    const text = await handleFindImporters(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error finding importers: ${message}` }],
      isError: true,
    };
  }
});

server.registerTool('find_exports', {
  description: 'Parse a file for export statements (named, default, re-exports)',
  inputSchema: {
    file_path: z.string().describe('Absolute path to the file'),
  },
}, async (args) => {
  try {
    const text = await handleFindExports(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error finding exports: ${message}` }],
      isError: true,
    };
  }
});

server.registerTool('find_test_files', {
  description: 'Find test files corresponding to a source file using common naming conventions',
  inputSchema: {
    file_path: z.string().describe('Relative path to the source file from project root'),
    project_root: z.string().describe('Absolute path to the project root directory'),
  },
}, async (args) => {
  try {
    const text = await handleFindTestFiles(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error finding test files: ${message}` }],
      isError: true,
    };
  }
});

server.registerTool('find_type_references', {
  description: 'Search for type or interface name usage across the codebase',
  inputSchema: {
    type_name: z.string().describe('The type or interface name to search for'),
    project_root: z.string().describe('Absolute path to the project root directory'),
  },
}, async (args) => {
  try {
    const text = await handleFindTypeReferences(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error finding type references: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in related-files server:', error);
  process.exit(1);
});
