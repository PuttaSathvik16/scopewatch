import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from '@scopewatch/client-adapters';
import * as cmds from '../src/commands.js';

/**
 * Section 19 acceptance bullet 6 ("updates ... can be rolled back") was
 * proven at the underlying LifecycleEngine level (Phase C) but had no test
 * exercising cmdRollback itself - the actual CLI-layer function main.ts
 * wires 'scopewatch rollback' to. Closing that gap directly: activate for
 * real, update for real (creating a real checkpoint), then roll back
 * through cmdRollback and confirm the real state and manifest revert.
 */
test('cmdRollback: a real active->updated sequence rolls back to the real prior version through the CLI command function', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmdrollback-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'rollback-cli-test-server';

  try {
    const manifestV1 = insertManifest(db, server_id, '1.0.0', 'npm', server_id, 'sha256:v1', '{}');
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, from as any, to as any, null);
      engine.confirmTransition(id, manifestV1);
    }
    strictEqual(engine.getState(server_id, CLAUDE_CODE_CLIENT_ID), 'active');

    // A real update, creating a real checkpoint of v1's active state
    const manifestV2 = insertManifest(db, server_id, '2.0.0', 'npm', server_id, 'sha256:v2', '{}');
    const updateIntent = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, 'active', 'updated', null);
    engine.confirmTransition(updateIntent, manifestV2);
    strictEqual(engine.getState(server_id, CLAUDE_CODE_CLIENT_ID), 'updated');

    // Approve it (matches the real flow) so we're rolling back FROM active, not from mid-review
    const approveIntent = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, 'updated', 'active', null);
    engine.confirmTransition(approveIntent, manifestV2);

    const currentManifestId = db
      .prepare('SELECT manifest_id FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get(server_id, CLAUDE_CODE_CLIENT_ID) as { manifest_id: number };
    strictEqual(currentManifestId.manifest_id, manifestV2, 'sanity: v2 should be active before rollback');

    // The actual function under test: cmdRollback, exactly as main.ts's 'rollback' command calls it
    const rollbackResult = cmds.cmdRollback(server_id, CLAUDE_CODE_CLIENT_ID, { db, projectRoot });
    ok(rollbackResult.ok, `cmdRollback should succeed, got: ${JSON.stringify(rollbackResult)}`);

    const afterRollback = db
      .prepare('SELECT manifest_id, state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get(server_id, CLAUDE_CODE_CLIENT_ID) as { manifest_id: number; state: string };
    strictEqual(afterRollback.manifest_id, manifestV1, 'cmdRollback must restore the real v1 manifest, not leave v2 active');
    strictEqual(afterRollback.state, 'active', 'rollback restores active state');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('cmdRollback: fails with a clear, actionable error when no checkpoint exists (never a raw crash)', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmdrollback-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'no-checkpoint-server';

  try {
    const manifestId = insertManifest(db, server_id, '1.0.0', 'npm', server_id, 'sha256:v1', '{}');
    const engine = new LifecycleEngine(db);
    // Only reach 'reviewed' - never touches 'active', so no checkpoint is ever created
    const id = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, 'discovered', 'reviewed', null);
    engine.confirmTransition(id, manifestId);

    let threw = false;
    try {
      cmds.cmdRollback(server_id, CLAUDE_CODE_CLIENT_ID, { db, projectRoot });
    } catch (err: any) {
      threw = true;
      ok(err.message.includes('No checkpoint available'), `Expected an actionable message, got: ${err.message}`);
    }
    ok(threw, 'cmdRollback should throw a clear error, not silently no-op, when there is nothing to roll back to');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
