import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface TransportMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Stdio Transport
 *
 * Implements the MCP stdio transport protocol for communication
 * between the host and tool servers.
 */
export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private messageId = 0;
  private pendingRequests: Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(
    private command: string,
    private args: string[] = [],
    private options: { cwd?: string } = {},
  ) {
    super();
  }

  /**
   * Start the tool server process
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.cwd,
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.emit('error', new Error(data.toString()));
      });

      this.process.on('error', (error) => {
        reject(error);
      });

      this.process.on('close', (code) => {
        this.emit('close', code);
      });

      // Wait a moment for process to start
      setTimeout(resolve, 100);
    });
  }

  /**
   * Send a request to the tool server
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.messageId;
    const message: TransportMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: unknown): void {
    const message: TransportMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.send(message);
  }

  /**
   * Stop the tool server process
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.pendingRequests.clear();
  }

  private send(message: TransportMessage): void {
    if (!this.process?.stdin) {
      throw new Error('Transport not started');
    }
    const json = JSON.stringify(message);
    this.process.stdin.write(`${json}\n`);
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (line.trim()) {
        this.handleMessage(line);
      }

      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(line: string): void {
    try {
      const message: TransportMessage = JSON.parse(line);

      if (message.id !== undefined) {
        // Response to a request
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      } else if (message.method) {
        // Notification or request from server
        this.emit('notification', message.method, message.params);
      }
    } catch (_error) {
      this.emit('error', new Error(`Failed to parse message: ${line}`));
    }
  }
}
