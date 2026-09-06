import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { storeSecret, deleteSecret, secretRef } from '@scopewatch/secrets';
import * as cmds from '../src/commands.js';
import type { SpawnFn } from '../src/mcp-client.js';

/**
 * Confirms cmdTest's real spawn env contains ONLY this server's own declared
 * secret (retrieved via the real keychain) plus the minimal baseline -
 * never an unrelated ambient environment variable, and never a secret
 * belonging to a different server.
 */
test('cmdTest: spawn env contains only this server\'s own secret and the minimal baseline, not ambient noise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-cmdtest-env-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'env-isolation-test-server';
  const ref = secretRef(server_id, 'MY_TOKEN');

  process.env['SCOPEWATCH_TEST_UNRELATED'] = 'must-not-leak-into-spawn';

  try {
    storeSecret(ref, 'the-real-token-value');

    const manifestId = insertManifest(
      db,
      server_id,
      '1.0.0',
      'npm',
      server_id,
      'sha256:test',
      JSON.stringify({
        source: { type: 'npm', location: server_id },
        secrets: [{ id: 'MY_TOKEN' }],
      })
    );
    const engine = new LifecycleEngine(db);
    const intentId = engine.startTransition(server_id, 'claude-code', 'discovered', 'reviewed', null);
    engine.confirmTransition(intentId, manifestId);

    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const spawnFn: SpawnFn = (_cmd, _args, env) => {
      capturedEnv = env;
      const child = new EventEmitter() as any;
      child.stdin = { write: () => {} };
      child.stdout = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'));
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }) + '\n'));
        }, 5);
      });
      return child;
    };

    await cmds.cmdTest(server_id, 'claude-code', { db, mcpSpawnFn: spawnFn });

    ok(capturedEnv, 'spawn should have been called');
    strictEqual(capturedEnv!['MY_TOKEN'], 'the-real-token-value', "this server's own secret must be present");
    ok(!('SCOPEWATCH_TEST_UNRELATED' in capturedEnv!), 'an unrelated ambient env var must never reach the spawn');
    ok(capturedEnv!['PATH'], 'PATH must still be present so the process can actually be resolved');
  } finally {
    delete process.env['SCOPEWATCH_TEST_UNRELATED'];
    deleteSecret(ref);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
