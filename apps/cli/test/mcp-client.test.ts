import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { EventEmitter } from 'node:events';
import { registerLiveSecret, _clearAllLiveSecretsForTesting } from '@scopewatch/secrets';
import { mcpHandshakeAndListTools } from '../src/mcp-client.js';
import type { SpawnFn } from '../src/mcp-client.js';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { write: (s: string) => void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
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

test('mcpHandshakeAndListTools: initialize itself rejected -> initialize_rejected category (not the generic fallback)', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unsupported protocol version' } }) + '\n')
    );
  });

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'initialize_rejected');
    ok(result.error.message.includes('Unsupported protocol version'));
  }
});

test('mcpHandshakeAndListTools: tools/list rejected AFTER a successful initialize -> tools_list_failed category', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }) + '\n'));
    setTimeout(() => {
      child.stdout.emit(
        'data',
        Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Missing required configuration' } }) + '\n')
      );
    }, 10);
  });

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'tools_list_failed');
    ok(result.error.message.includes('Missing required configuration'));
  }
});

test('mcpHandshakeAndListTools: valid JSON-RPC success but wrong-shaped result (tools is not an array) -> malformed_response, not silently accepted', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'));
    setTimeout(() => {
      // result.tools is a string, not an array - syntactically valid JSON-RPC, wrong shape
      child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: 'oops' } }) + '\n'));
    }, 10);
  });

  const result = await resultPromise;
  strictEqual(result.ok, false, 'a wrong-shaped result must NOT be silently accepted as ok:true with an empty tool list');
  if (!result.ok) strictEqual(result.error.category, 'malformed_response');
});

test('mcpHandshakeAndListTools: a tool entry missing required fields also -> malformed_response', async () => {
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 5000);
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'));
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'x' }] } }) + '\n')); // missing description
    }, 10);
  });

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) strictEqual(result.error.category, 'malformed_response');
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

// --- Sanitized log capture: proven wired into the real failure path, not just available ---

test('SANITIZED LOG CAPTURE: a real secret value in the failing server\'s stderr is redacted in the diagnostic output shown to the user', async () => {
  _clearAllLiveSecretsForTesting();
  const REAL_SECRET = 'sk-real-secret-abc123xyz';
  registerLiveSecret(REAL_SECRET); // simulates retrieveSecret() having already registered it, per Phase D

  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 200);

  try {
    process.nextTick(() => {
      // The real failing server writes something resembling a secret value to stderr,
      // e.g. logging its own config on a startup failure.
      child.stderr.emit('data', Buffer.from(`FATAL: could not authenticate with token ${REAL_SECRET}\n`));
    });
    // No stdout response at all -> times out, exercising the failure path that carries stderr context

    const result = await resultPromise;
    strictEqual(result.ok, false);
    if (!result.ok) {
      ok(!result.error.message.includes(REAL_SECRET), `Raw secret leaked into the diagnostic message shown to the user: "${result.error.message}"`);
      ok(result.error.message.includes('[REDACTED]'), `Expected the redaction marker to appear in the diagnostic output. Got: "${result.error.message}"`);
      ok(result.error.stderrContext, 'stderr context should be attached to the error');
      ok(!result.error.stderrContext!.includes(REAL_SECRET), 'the stored stderrContext field itself must also be redacted, not just the message');
    }
  } finally {
    _clearAllLiveSecretsForTesting();
  }
});

test('SANITIZED LOG CAPTURE: stderr with no secret content passes through unredacted (no over-suppression of real diagnostics)', async () => {
  _clearAllLiveSecretsForTesting();
  const child = fakeChild();
  const spawnFn: SpawnFn = () => child as any;

  const resultPromise = mcpHandshakeAndListTools('npx', ['-y', 'x'], {}, spawnFn, 200);
  process.nextTick(() => {
    child.stderr.emit('data', Buffer.from('Error: cannot bind to port 3000, already in use\n'));
  });

  const result = await resultPromise;
  strictEqual(result.ok, false);
  if (!result.ok) {
    ok(result.error.message.includes('cannot bind to port 3000'), `Expected real diagnostic detail to survive redaction. Got: "${result.error.message}"`);
  }
});
