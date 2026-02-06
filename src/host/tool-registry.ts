import { ToolServerError } from '../errors.js';
import type { StdioTransport } from './transport.js';

export interface ToolServer {
  name: string;
  transport: StdioTransport;
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

interface McpToolsListResponse {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

interface McpContentBlock {
  type: string;
  text?: string;
}

interface McpToolCallResponse {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface ServerConfig {
  name: string;
  path: string;
}

/**
 * Tool Registry
 *
 * Maps tool names to their MCP servers and handles routing of tool calls.
 * Supports two modes:
 * - Live mode: spawns real tool server processes and routes via StdioTransport
 * - Standalone mode: tools registered manually with registerToolManually() for testing
 */
export class ToolRegistry {
  private servers: Map<string, ToolServer> = new Map();
  private toolToServer: Map<string, string> = new Map();

  /**
   * Register a tool server with an active transport.
   * Performs capability negotiation by calling tools/list on the server.
   */
  async registerServer(name: string, transport: StdioTransport): Promise<void> {
    const response = (await transport.request('tools/list', {})) as McpToolsListResponse;

    const capabilities: ToolCapability[] = (response.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? {},
    }));

    this.servers.set(name, { name, transport, capabilities });

    for (const cap of capabilities) {
      this.toolToServer.set(cap.name, name);
    }
  }

  /**
   * Register a tool manually (for testing or standalone use without a transport).
   */
  registerToolManually(serverName: string, capability: ToolCapability): void {
    this.toolToServer.set(capability.name, serverName);

    const server = this.servers.get(serverName);
    if (server) {
      server.capabilities.push(capability);
    } else {
      this.servers.set(serverName, {
        name: serverName,
        transport: null as unknown as StdioTransport,
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
   * Execute a tool call by routing to the appropriate server transport.
   */
  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const serverName = this.toolToServer.get(request.name);
    if (!serverName) {
      return {
        content: `Unknown tool: ${request.name}`,
        isError: true,
      };
    }

    const server = this.servers.get(serverName);
    if (!server) {
      return {
        content: `Server not found: ${serverName}`,
        isError: true,
      };
    }

    // If no transport (manual registration / test mode), return placeholder
    if (!server.transport) {
      return {
        content: `Tool ${request.name} called with ${JSON.stringify(request.arguments)}`,
      };
    }

    try {
      const response = (await server.transport.request('tools/call', {
        name: request.name,
        arguments: request.arguments,
      })) as McpToolCallResponse;

      // Extract text content from the MCP response
      const textParts = (response.content ?? [])
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text);

      return {
        content: textParts.join('\n') || '(no content)',
        isError: response.isError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolServerError(serverName, `Tool call "${request.name}" failed: ${message}`);
    }
  }

  /**
   * Shutdown all tool servers
   */
  async shutdown(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const server of this.servers.values()) {
      if (server.transport) {
        stopPromises.push(server.transport.stop());
      }
    }
    await Promise.allSettled(stopPromises);

    this.servers.clear();
    this.toolToServer.clear();
  }
}
