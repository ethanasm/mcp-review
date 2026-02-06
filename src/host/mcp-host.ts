import { resolve } from 'node:path';
import type { Config } from '../config.js';
import type { ResolvedRange } from '../git/resolver.js';
import { debug, timer } from '../logger.js';
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
 * Resolve the command + args for spawning a TypeScript file.
 * Prefers local `tsx` (from node_modules/.bin) for speed, falls back to `npx tsx`.
 */
function resolveRunner(projectRoot: string): {
  command: string;
  args: (serverPath: string) => string[];
} {
  const localTsx = resolve(projectRoot, 'node_modules', '.bin', 'tsx');
  // Using the local tsx binary directly avoids npx resolution overhead
  return { command: localTsx, args: (serverPath: string) => [serverPath] };
}

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
  private tokenBudget: number;
  private tokensUsed = 0;

  constructor(options: MCPHostOptions) {
    this.toolRegistry = new ToolRegistry();
    this.conversation = new ConversationManager(options);
    this.tokenBudget = DEFAULT_TOKEN_BUDGET;
  }

  /**
   * Initialize the MCP host and start tool servers.
   * Spawns all tool server processes in parallel, performs capability
   * negotiation, and registers discovered tools. Failures are logged but non-fatal.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const endInit = timer('mcp-host', 'server initialization (all servers)');
    const projectRoot = resolve(import.meta.dirname, '..', '..');
    const runner = resolveRunner(projectRoot);

    const results = await Promise.allSettled(
      TOOL_SERVERS.map(async (serverConfig) => {
        const endServer = timer('mcp-host', `start server: ${serverConfig.name}`);
        const serverPath = resolve(projectRoot, serverConfig.path);
        const transport = new StdioTransport(runner.command, runner.args(serverPath));

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

        endServer();
        debug('mcp-host', `Started server: ${serverConfig.name}`);
        return serverConfig.name;
      }),
    );

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        const serverName = TOOL_SERVERS[i]!.name;
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[mcp-host] Warning: Failed to start ${serverName}: ${message}`);
        // Continue without this server — graceful degradation
      }
    }

    endInit();
    this.initialized = true;
  }

  /**
   * Run a review for the given range.
   *
   * Accepts pre-fetched diff and stats so the caller doesn't re-fetch them.
   */
  async runReview(
    range: ResolvedRange,
    prefetched: { diff: string; stats: import('../git/commands.js').DiffStats },
    spinner?: import('ora').Ora,
  ): Promise<ReviewResult> {
    if (!this.initialized) {
      throw new Error('MCPHost not initialized. Call initialize() first.');
    }

    return this.conversation.runReview(range, this.toolRegistry, prefetched, spinner);
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
