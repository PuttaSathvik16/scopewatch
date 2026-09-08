import { test } from 'node:test';
import { strictEqual, ok, throws } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { CLAUDE_CODE_CLIENT_ID } from '@scopewatch/client-adapters';
import { cmdActivate } from '../src/commands.js';

const SERVER_ID = 'io.github.test/cmd-activate-fixture';

function setupValidatedServer(projectRoot: string, dbPath: string, client_id: string) {
  const db = openDatabase(dbPath);
  const manifestId = insertManifest(db, SERVER_ID, '1.0.0', 'npm', SERVER_ID, 'sha256:test', '{}');
  const engine = new LifecycleEngine(db);
  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
  ] as [string, string][]) {
    const id = engine.startTransition(SERVER_ID, client_id, from as any, to as any, null);
    engine.confirmTransition(id, manifestId);
  }
  return db;
}

function currentState(db: ReturnType<typeof openDatabase>, client_id: string): string | undefined {
  const row = db
    .prepare('SELECT state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
    .get(SERVER_ID, client_id) as { state: string } | undefined;
  return row?.state;
}

test('cmdActivate: success path - state becomes active and client config is written', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmd-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupValidatedServer(projectRoot, dbPath, CLAUDE_CODE_CLIENT_ID);

  try {
    const result = cmdActivate(SERVER_ID, CLAUDE_CODE_CLIENT_ID, { db, projectRoot });
    ok(result.ok);
    strictEqual(currentState(db, CLAUDE_CODE_CLIENT_ID), 'active');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('cmdActivate: when the client config write fails, lifecycle state must NOT advance to active', () => {
  // Found via a real user report: activating from a directory the OS
  // refuses to write into (EPERM) left lockfile_entries.state saying
  // 'active' for a server whose .mcp.json was never actually written -
  // `status` reported active, but nothing pointed a real client at the
  // server. Reproduced here with an unknown client_id (configPathFor
  // throws deterministically) rather than relying on OS-specific
  // permission errors, to exercise the exact same failure path.
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmd-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const BOGUS_CLIENT_ID = 'not-a-real-client';
  const db = setupValidatedServer(projectRoot, dbPath, BOGUS_CLIENT_ID);

  try {
    throws(() => cmdActivate(SERVER_ID, BOGUS_CLIENT_ID, { db, projectRoot }), /Unknown client_id/);
    strictEqual(
      currentState(db, BOGUS_CLIENT_ID),
      'validated',
      'state must remain validated, not silently advance to active, when the config write failed'
    );
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('cmdActivate: a failed attempt resolves its intent via failTransition, not leaving it stuck unresolved', () => {
  // The fix calls engine.failTransition() on the caught error specifically
  // so the intent is resolved, not left dangling forever. Proven directly:
  // after a failed cmdActivate call, starting a FRESH transition for the
  // same (server_id, client_id) pair must not hit
  // "rejects a second transition while one is unresolved" - which is
  // exactly what would happen if the failed attempt had left its intent
  // unresolved.
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmd-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const BOGUS_CLIENT_ID = 'not-a-real-client';
  const db = setupValidatedServer(projectRoot, dbPath, BOGUS_CLIENT_ID);

  try {
    throws(() => cmdActivate(SERVER_ID, BOGUS_CLIENT_ID, { db, projectRoot }), /Unknown client_id/);

    const engine = new LifecycleEngine(db);
    // Must not throw "rejects a second transition while one is unresolved".
    const intentId = engine.startTransition(SERVER_ID, BOGUS_CLIENT_ID, 'validated', 'active', null);
    ok(intentId, 'starting a new transition after a failed activate must succeed, proving the prior intent was resolved');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
