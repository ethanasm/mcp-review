import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StdioTransport } from '../../src/host/transport.js';

// Test the message handling logic without spawning real processes.
// We access private methods via type casting to test parsing in isolation.

describe('StdioTransport', () => {
  let transport: StdioTransport;

  beforeEach(() => {
    transport = new StdioTransport('echo', ['test']);
  });

  describe('constructor', () => {
    it('creates a transport instance', () => {
      expect(transport).toBeInstanceOf(StdioTransport);
    });
  });

  describe('send without start', () => {
    it('throws when sending before start', () => {
      expect(() => transport.notify('test')).toThrow('Transport not started');
    });
  });

  describe('message handling', () => {
    it('resolves pending request on response', () => {
      // Simulate the internal handleMessage behavior by testing through
      // the public interface after setting up internal state
      const handleMessage = (
        transport as unknown as { handleMessage: (line: string) => void }
      ).handleMessage.bind(transport);
      const pendingRequests = (
        transport as unknown as {
          pendingRequests: Map<
            string | number,
            { resolve: (v: unknown) => void; reject: (e: Error) => void }
          >;
        }
      ).pendingRequests;

      const resolve = vi.fn();
      const reject = vi.fn();
      pendingRequests.set(1, { resolve, reject });

      handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: 'test' } }));

      expect(resolve).toHaveBeenCalledWith({ data: 'test' });
      expect(reject).not.toHaveBeenCalled();
    });

    it('rejects pending request on error response', () => {
      const handleMessage = (
        transport as unknown as { handleMessage: (line: string) => void }
      ).handleMessage.bind(transport);
      const pendingRequests = (
        transport as unknown as {
          pendingRequests: Map<
            string | number,
            { resolve: (v: unknown) => void; reject: (e: Error) => void }
          >;
        }
      ).pendingRequests;

      const resolve = vi.fn();
      const reject = vi.fn();
      pendingRequests.set(2, { resolve, reject });

      handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32600, message: 'Invalid Request' },
        }),
      );

      expect(reject).toHaveBeenCalledWith(expect.any(Error));
      expect(reject.mock.calls[0]?.[0]?.message).toBe('Invalid Request');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('emits notification for messages without id', () => {
      const handleMessage = (
        transport as unknown as { handleMessage: (line: string) => void }
      ).handleMessage.bind(transport);

      const listener = vi.fn();
      transport.on('notification', listener);

      handleMessage(JSON.stringify({ jsonrpc: '2.0', method: 'update', params: { x: 1 } }));

      expect(listener).toHaveBeenCalledWith('update', { x: 1 });
    });

    it('emits error on invalid JSON', () => {
      const handleMessage = (
        transport as unknown as { handleMessage: (line: string) => void }
      ).handleMessage.bind(transport);

      const listener = vi.fn();
      transport.on('error', listener);

      handleMessage('not valid json');

      expect(listener).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('handleData buffering', () => {
    it('processes complete lines and buffers partial data', () => {
      const handleData = (
        transport as unknown as { handleData: (data: string) => void }
      ).handleData.bind(transport);
      const handleMessage = vi.fn();
      (transport as unknown as { handleMessage: (line: string) => void }).handleMessage =
        handleMessage;

      // Send partial data
      handleData('{"jsonrpc":"2.0"');
      expect(handleMessage).not.toHaveBeenCalled();

      // Complete the line
      handleData(',"method":"test"}\n');
      expect(handleMessage).toHaveBeenCalledWith('{"jsonrpc":"2.0","method":"test"}');
    });

    it('processes multiple lines in one chunk', () => {
      const handleData = (
        transport as unknown as { handleData: (data: string) => void }
      ).handleData.bind(transport);
      const handleMessage = vi.fn();
      (transport as unknown as { handleMessage: (line: string) => void }).handleMessage =
        handleMessage;

      handleData('{"line":1}\n{"line":2}\n');
      expect(handleMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('clears pending requests', async () => {
      const pendingRequests = (
        transport as unknown as {
          pendingRequests: Map<
            string | number,
            { resolve: (v: unknown) => void; reject: (e: Error) => void }
          >;
        }
      ).pendingRequests;

      pendingRequests.set(1, { resolve: vi.fn(), reject: vi.fn() });
      await transport.stop();
      expect(pendingRequests.size).toBe(0);
    });
  });
});
