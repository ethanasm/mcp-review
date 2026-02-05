export interface ToolServer {
  name: string;
  process: unknown; // Will be ChildProcess
  capabilities: ToolCapability[];
}

export interface ToolCapability {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  content: string;
  isError?: boolean;
}

/**
 * Tool Registry
 *
 * Maps tool names to their MCP servers and handles routing of tool calls.
 */
export class ToolRegistry {
  private servers: Map<string, ToolServer> = new Map();
  private toolToServer: Map<string, string> = new Map();

  async initialize(): Promise<void> {
    // TODO: Start each tool server process and perform capability negotiation
    // For now, we'll register the expected tools

    // Git Diff Tool
    this.registerTool('git-diff', {
      name: 'get_diff',
      description: 'Get the full git diff for the review scope',
      inputSchema: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'Git revision range' },
          file_path: { type: 'string', description: 'Optional: limit diff to specific file' },
          context_lines: { type: 'number', description: 'Context lines around changes' },
        },
        required: ['range'],
      },
    });

    this.registerTool('git-diff', {
      name: 'get_diff_stats',
      description: 'Get file change summary (files changed, insertions, deletions)',
      inputSchema: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'Git revision range' },
        },
        required: ['range'],
      },
    });

    this.registerTool('git-diff', {
      name: 'get_commit_messages',
      description: 'Get commit messages in the review range to understand developer intent',
      inputSchema: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'Git revision range' },
        },
        required: ['range'],
      },
    });

    // File Context Tool
    this.registerTool('file-context', {
      name: 'read_file',
      description: 'Read full file contents with line numbers',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
        },
        required: ['path'],
      },
    });

    this.registerTool('file-context', {
      name: 'read_lines',
      description: 'Read specific line range from a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          start_line: { type: 'number', description: 'Starting line number' },
          end_line: { type: 'number', description: 'Ending line number' },
        },
        required: ['path', 'start_line', 'end_line'],
      },
    });
  }

  private registerTool(serverName: string, capability: ToolCapability): void {
    this.toolToServer.set(capability.name, serverName);

    const server = this.servers.get(serverName);
    if (server) {
      server.capabilities.push(capability);
    } else {
      this.servers.set(serverName, {
        name: serverName,
        process: null,
        capabilities: [capability],
      });
    }
  }

  /**
   * Get all available tools for the LLM
   */
  getAvailableTools(): ToolCapability[] {
    const tools: ToolCapability[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.capabilities);
    }
    return tools;
  }

  /**
   * Execute a tool call
   */
  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const serverName = this.toolToServer.get(request.name);
    if (!serverName) {
      return {
        content: `Unknown tool: ${request.name}`,
        isError: true,
      };
    }

    // TODO: Actually route to the MCP server
    // For now, return a placeholder
    return {
      content: `Tool ${request.name} called with ${JSON.stringify(request.arguments)}`,
    };
  }

  /**
   * Shutdown all tool servers
   */
  async shutdown(): Promise<void> {
    // TODO: Send shutdown signal to all servers
    this.servers.clear();
    this.toolToServer.clear();
  }
}
