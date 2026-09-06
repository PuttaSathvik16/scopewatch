import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { EventEmitter } from 'node:events';
import { mcpHandshakeAndListTools } from '../src/mcp-client.js';
import type { SpawnFn } from '../src/mcp-client.js';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: (s: string) => void };
    stdout: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stdin = { write: () => {} };
  child.kill = () => {};
  return child;
}

test('mcpHandshakeAndListTools: spawn throws -> spawn_failed category', async () => {
  const spawnFn: SpawnFn = () => {
    throw new Error('ENOENT: no such file');
  };

  const result = await mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn);
  strictEqual(result.ok, false);
  if (!result.ok) strictEqual(result.error.category, 'spawn_failed');
});

test('mcpHandshakeAndListTools: no response before timeout -> handshake_timeout category', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const result = await mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 50);
  strictEqual(result.ok, false);
  if (!result.ok) strictEqual(result.error.category, 'handshake_timeout');
});

test('mcpHandshakeAndListTools: malformed (non-JSON) stdout -> malformed_response category', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => child.stdout.emit('data', Buffer.from('this is not json\n')));

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) strictEqual(result.error.category, 'malformed_response');
});

test('mcpHandshakeAndListTools: JSON-RPC error response -> protocol_error category', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }) + '\n'));
  });

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'protocol_error');
    ok(result.error.message.includes('Method not found'));
  }
});

test('mcpHandshakeAndListTools: successful handshake returns real tool list', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }) + '\n')
    );
  });
  process.nextTick(() => {
    setTimeout(() => {
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'read_thing', description: 'reads' }] } }) + '\n')
      );
    }, 10);
  });

  const result = await resultPromise;
  strictEqual(result.ok, true);
  if (result.ok) {
    strictEqual(result.tools.length, 1);
    strictEqual(result.tools[0]!.name, 'read_thing');
  }
});
