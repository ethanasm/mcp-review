import { resolve } from 'node:path';
import type { Config } from '../config.js';
import type { ResolvedRange } from '../git/resolver.js';
import type { ReviewResult } from '../reviewer.js';
import { ConversationManager } from './conversation.js';
import type { ServerConfig } from './tool-registry.js';
import { ToolRegistry } from './tool-registry.js';
import { StdioTransport } from './transport.js';

export interface MCPHostOptions extends Config {
  verbose?: boolean;
}

const DEFAULT_TOKEN_BUDGET = 100_000;

/**
 * Server configurations for all tool servers.
 * Paths are relative to the project src directory.
 */
const TOOL_SERVERS: ServerConfig[] = [
  { name: 'git-diff', path: 'src/tools/git-diff/server.ts' },
  { name: 'file-context', path: 'src/tools/file-context/server.ts' },
  { name: 'conventions', path: 'src/tools/conventions/server.ts' },
  { name: 'related-files', path: 'src/tools/related-files/server.ts' },
];

/**
 * MCP Host Runtime
 *
 * Manages the lifecycle of MCP tool servers and orchestrates
 * the review conversation with the LLM.
 */
export class MCPHost {
  private toolRegistry: ToolRegistry;
  private conversation: ConversationManager;
  private transports: StdioTransport[] = [];
  private initialized = false;
  private options: MCPHostOptions;
  private tokenBudget: number;
  private tokensUsed = 0;

  constructor(options: MCPHostOptions) {
    this.toolRegistry = new ToolRegistry();
    this.conversation = new ConversationManager(options);
    this.options = options;
    this.tokenBudget = DEFAULT_TOKEN_BUDGET;
  }

  /**
   * Initialize the MCP host and start tool servers.
   * Spawns each tool server process, performs capability negotiation,
   * and registers discovered tools. Failures are logged but non-fatal.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const projectRoot = resolve(import.meta.dirname, '..', '..');

    for (const serverConfig of TOOL_SERVERS) {
      try {
        const serverPath = resolve(projectRoot, serverConfig.path);
        const transport = new StdioTransport('npx', ['tsx', serverPath]);

        await transport.start();

        // MCP protocol: send initialize request
        await transport.request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-review-host', version: '0.1.0' },
        });

        // Notify server that initialization is complete
        transport.notify('notifications/initialized', {});

        // Discover tools from the server
        await this.toolRegistry.registerServer(serverConfig.name, transport);
        this.transports.push(transport);

        if (this.options.verbose) {
          console.error(`[mcp-host] Started server: ${serverConfig.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[mcp-host] Warning: Failed to start ${serverConfig.name}: ${message}`);
        // Continue without this server — graceful degradation
      }
    }

    this.initialized = true;
  }

  /**
   * Run a review for the given range
   */
  async runReview(range: ResolvedRange, spinner?: import('ora').Ora): Promise<ReviewResult> {
    if (!this.initialized) {
      throw new Error('MCPHost not initialized. Call initialize() first.');
    }

    return this.conversation.runReview(range, this.toolRegistry, spinner);
  }

  /**
   * Track approximate token usage from a tool response.
   * Simple heuristic: ~4 chars per token.
   */
  addTokenUsage(text: string): void {
    this.tokensUsed += Math.ceil(text.length / 4);
  }

  /**
   * Get remaining token budget.
   */
  getTokenBudgetRemaining(): number {
    return Math.max(0, this.tokenBudget - this.tokensUsed);
  }

  /**
   * Check whether the token budget is running low (< 20% remaining).
   */
  isTokenBudgetLow(): boolean {
    return this.getTokenBudgetRemaining() < this.tokenBudget * 0.2;
  }

  /**
   * Shutdown all tool servers gracefully
   */
  async shutdown(): Promise<void> {
    await this.toolRegistry.shutdown();
    this.transports = [];
    this.initialized = false;
    this.tokensUsed = 0;
  }
}
