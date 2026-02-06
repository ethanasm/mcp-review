import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  handleFindSimilarPatterns,
  handleGetProjectConventions,
  handleScanLintConfig,
} from './handlers.js';

const server = new McpServer(
  { name: 'conventions', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.registerTool('scan_lint_config', {
  description: 'Find and read linting/formatting configuration files in the project',
  inputSchema: {
    project_root: z.string().optional().describe('Absolute path to the project root directory (defaults to cwd)'),
  },
}, async (args) => {
  try {
    const text = await handleScanLintConfig(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error scanning lint config: ${message}` }],
      isError: true,
    };
  }
});

server.registerTool('find_similar_patterns', {
  description: 'Search the codebase for a pattern string and return matching file excerpts',
  inputSchema: {
    pattern: z.string().describe('The pattern string to search for'),
    project_root: z.string().optional().describe('Absolute path to the project root directory (defaults to cwd)'),
    file_glob: z
      .string()
      .optional()
      .describe('File glob to filter search (e.g. "*.ts", default: "*.ts")'),
  },
}, async (args) => {
  try {
    const text = await handleFindSimilarPatterns(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error finding patterns: ${message}` }],
      isError: true,
    };
  }
});

server.registerTool('get_project_conventions', {
  description: 'Read project conventions from .mcp-review.yml configuration',
  inputSchema: {
    project_root: z.string().optional().describe('Absolute path to the project root directory (defaults to cwd)'),
  },
}, async (args) => {
  try {
    const text = await handleGetProjectConventions(args);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error reading conventions: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in conventions server:', error);
  process.exit(1);
});
