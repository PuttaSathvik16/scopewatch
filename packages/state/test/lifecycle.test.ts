import { test } from 'node:test';
import { strictEqual, ok, notStrictEqual, throws } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db.js';
import { LifecycleEngine } from '../src/lifecycle-engine.js';
import { insertManifest } from '../src/manifest-repo.js';
import type { SqliteDatabase } from '../src/db.js';

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-test-'));
  return join(dir, 'state.db');
}

function seedManifest(db: SqliteDatabase, server_id: string, version: string): number {
  return insertManifest(db, server_id, version, 'npm', 'example-tools', `sha256:${version}`, '{}');
}

// ---------------------------------------------------------------------------
// 1. Migration: confirm it runs clean against a fresh database file
// ---------------------------------------------------------------------------

test('Migration runs clean against a fresh database file', () => {
  const dbPath = freshDbPath();
  ok(!existsSync(dbPath), 'db file should not exist yet');

  const db = openDatabase(dbPath);
  ok(existsSync(dbPath), 'db file should now exist');

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: any) => r.name);

  ok(tables.includes('manifests'), 'manifests table exists');
  ok(tables.includes('lockfile_entries'), 'lockfile_entries table exists');
  ok(tables.includes('capability_diffs'), 'capability_diffs table exists');
  ok(tables.includes('rollback_checkpoints'), 'rollback_checkpoints table exists');
  ok(tables.includes('lifecycle_events'), 'lifecycle_events table exists');
  ok(tables.includes('schema_migrations'), 'schema_migrations table exists');

  const migrations = db.prepare('SELECT version FROM schema_migrations').all();
  strictEqual(migrations.length, 1, 'exactly one migration applied');

  // Re-opening the same file should be a no-op (idempotent migrations)
  db.close();
  const db2 = openDatabase(dbPath);
  const migrations2 = db2.prepare('SELECT version FROM schema_migrations').all();
  strictEqual(migrations2.length, 1, 'reopening does not re-apply migrations');
  db2.close();

  rmSync(dbPath, { force: true });
});

test('CHECK constraints reject invalid enum values', () => {
  const db = openDatabase(freshDbPath());
  const manifestId = seedManifest(db, 'test-server', '1.0.0');

  throws(() => {
    db.prepare(
      `INSERT INTO lockfile_entries (server_id, client_id, manifest_id, state, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('test-server', 'claude-code', manifestId, 'bogus-state', 0);
  }, /CHECK constraint failed/);

  db.close();
});

// ---------------------------------------------------------------------------
// 2. Full round-trip lifecycle
// ---------------------------------------------------------------------------

test('Server can be pushed through every lifecycle state and back', () => {
  const db = openDatabase(freshDbPath());
  const engine = new LifecycleEngine(db);
  const manifestId = seedManifest(db, 'test-server', '1.0.0');
  const server_id = 'test-server';
  const client_id = 'claude-code';

  const path: [string, string][] = [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ];

  for (const [from, to] of path) {
    const intentId = engine.startTransition(server_id, client_id, from as any, to as any, null);
    engine.confirmTransition(intentId, manifestId);
    strictEqual(engine.getState(server_id, client_id), to, `state should be ${to} after transition`);
  }

  // Now go through an update cycle: active -> updated -> active
  const manifestId2 = seedManifest(db, server_id, '1.1.0');
  const updateIntent = engine.startTransition(server_id, client_id, 'active', 'reviewed', null);
  engine.confirmTransition(updateIntent, manifestId2);
  strictEqual(engine.getState(server_id, client_id), 'reviewed');

  const reactivateIntent = engine.startTransition(server_id, client_id, 'reviewed', 'active', null);
  engine.confirmTransition(reactivateIntent, manifestId2);
  strictEqual(engine.getState(server_id, client_id), 'active');

  // Disable and remove
  const disableIntent = engine.startTransition(server_id, client_id, 'active', 'disabled', null);
  engine.confirmTransition(disableIntent);
  strictEqual(engine.getState(server_id, client_id), 'disabled');

  const removeIntent = engine.startTransition(server_id, client_id, 'disabled', 'removed', null);
  engine.confirmTransition(removeIntent);
  strictEqual(engine.getState(server_id, client_id), 'removed');

  // Full event log should record every transition_intent + transition_confirmed pair
  const events = engine.getEvents(server_id, client_id);
  const intents = events.filter((e) => e.event_type === 'transition_intent');
  const confirmed = events.filter((e) => e.event_type === 'transition_confirmed');
  // 5 initial (discovered->active) + update (active->reviewed) + reactivate (reviewed->active)
  // + disable (active->disabled) + remove (disabled->removed) = 9
  strictEqual(intents.length, 9, 'nine transitions attempted');
  strictEqual(confirmed.length, 9, 'nine transitions confirmed');

  db.close();
});

// ---------------------------------------------------------------------------
// 3. Single-unresolved-intent invariant
// ---------------------------------------------------------------------------

test('startTransition rejects a second transition while one is unresolved', () => {
  const db = openDatabase(freshDbPath());
  const engine = new LifecycleEngine(db);
  seedManifest(db, 'test-server', '1.0.0');

  const intentId = engine.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null);
  ok(intentId > 0, 'first transition should start successfully');

  throws(
    () => engine.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null),
    /Transition already in progress/,
    'second transition should be rejected while first is unresolved'
  );

  // Confirming resolves it, then a new transition is allowed
  engine.confirmTransition(intentId, seedManifest(db, 'test-server', '1.0.0-x'));
  const secondIntent = engine.startTransition('test-server', 'claude-code', 'reviewed', 'installed', null);
  ok(secondIntent > intentId, 'second transition now succeeds after first resolved');

  db.close();
});

// ---------------------------------------------------------------------------
// 4. Recovery-gating: ensureRecovered() runs before any public method proceeds
// ---------------------------------------------------------------------------

test('Recovery runs automatically before the first transition on a fresh engine instance', () => {
  const dbPath = freshDbPath();
  const db1 = openDatabase(dbPath);
  const manifestId = seedManifest(db1, 'test-server', '1.0.0');

  // Manually insert an unresolved intent, simulating a crash (bypassing the engine API,
  // as if a previous process had called startTransition and then died before confirming)
  db1
    .prepare(
      `INSERT INTO lifecycle_events (server_id, client_id, from_state, to_state, event_type, created_at)
       VALUES (?, ?, 'discovered', 'reviewed', 'transition_intent', ?)`
    )
    .run('test-server', 'claude-code', Math.floor(Date.now() / 1000));
  db1.close();

  // Simulate process restart: brand-new engine instance over the same db file
  const db2 = openDatabase(dbPath);
  const engine2 = new LifecycleEngine(db2);

  // The very first call (startTransition) must trigger recovery internally before proceeding.
  // Recovery resolves the stale intent (no checkpoint case: discovered was never 'active').
  const intentId = engine2.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null);
  ok(intentId > 0, 'startTransition succeeds because recovery resolved the stale intent first');

  const unresolvedAfter = engine2.getUnresolvedIntent('test-server', 'claude-code');
  strictEqual(unresolvedAfter!.id, intentId, 'only the NEW intent is unresolved; the stale one was recovered');

  db2.close();
});

// ---------------------------------------------------------------------------
// 5. Rollback invariant + behavior
// ---------------------------------------------------------------------------

test('rollback restores the last checkpoint and records a rollback event', () => {
  const db = openDatabase(freshDbPath());
  const engine = new LifecycleEngine(db);
  const server_id = 'test-server';
  const client_id = 'claude-code';

  const manifestV1 = seedManifest(db, server_id, '1.0.0');
  const manifestV2 = seedManifest(db, server_id, '2.0.0');

  // Walk to active on v1
  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ] as [string, string][]) {
    const id = engine.startTransition(server_id, client_id, from as any, to as any, null);
    engine.confirmTransition(id, manifestV1);
  }
  strictEqual(engine.getState(server_id, client_id), 'active');

  // Begin an update: active -> reviewed (creates a checkpoint of the v1 active state)
  const updateIntent = engine.startTransition(server_id, client_id, 'active', 'reviewed', null);
  engine.confirmTransition(updateIntent, manifestV2);
  strictEqual(engine.getState(server_id, client_id), 'reviewed');

  // Now roll back
  engine.rollback(server_id, client_id);
  strictEqual(engine.getState(server_id, client_id), 'active', 'rollback restores active state');

  const entry = db
    .prepare('SELECT manifest_id FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
    .get(server_id, client_id) as { manifest_id: number };
  strictEqual(entry.manifest_id, manifestV1, 'rollback restores the v1 manifest, not v2');

  const events = engine.getEvents(server_id, client_id);
  const rollbackEvent = events.find((e) => e.event_type === 'rollback');
  ok(rollbackEvent, 'a rollback event was recorded');

  db.close();
});

test('rollback refuses when a transition is unresolved (invariant check)', () => {
  const db = openDatabase(freshDbPath());
  const engine = new LifecycleEngine(db);
  const server_id = 'test-server';
  const client_id = 'claude-code';
  const manifestV1 = seedManifest(db, server_id, '1.0.0');

  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ] as [string, string][]) {
    const id = engine.startTransition(server_id, client_id, from as any, to as any, null);
    engine.confirmTransition(id, manifestV1);
  }

  // Start an update but never confirm it (unresolved)
  engine.startTransition(server_id, client_id, 'active', 'reviewed', null);

  throws(
    () => engine.rollback(server_id, client_id),
    /transition is still unresolved/,
    'rollback should refuse while a transition is unresolved'
  );

  db.close();
});

test('rollback fails clearly when no checkpoint exists', () => {
  const db = openDatabase(freshDbPath());
  const engine = new LifecycleEngine(db);
  seedManifest(db, 'test-server', '1.0.0');

  // Never reached 'active', so no checkpoint was ever created
  const id = engine.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null);
  engine.confirmTransition(id, 1);

  throws(
    () => engine.rollback('test-server', 'claude-code'),
    /No checkpoint available/,
    'rollback should fail with an actionable message, not a raw exception'
  );

  db.close();
});

// ---------------------------------------------------------------------------
// 6. Crash-consistency tests (4 kill points)
// ---------------------------------------------------------------------------

test('Crash point 1: kill before intent commits -> recovery finds nothing, no-op', () => {
  const dbPath = freshDbPath();
  const db1 = openDatabase(dbPath);
  seedManifest(db1, 'test-server', '1.0.0');
  // Simulate: process was about to call startTransition but died before doing so.
  // No lifecycle_events row is ever written. This is the "clean" case.
  db1.close();

  const db2 = openDatabase(dbPath);
  const engine2 = new LifecycleEngine(db2);
  engine2.onStartup(); // explicit call, simulating startup recovery scan

  const events = engine2.getEvents('test-server', 'claude-code');
  strictEqual(events.length, 0, 'no events exist; recovery correctly does nothing');

  db2.close();
});

test('Crash point 2: kill after intent+checkpoint commit, before confirmation (active -> update)', () => {
  const dbPath = freshDbPath();
  const db1 = openDatabase(dbPath);
  const engine1 = new LifecycleEngine(db1);
  const server_id = 'test-server';
  const client_id = 'claude-code';
  const manifestV1 = seedManifest(db1, server_id, '1.0.0');
  const manifestV2 = seedManifest(db1, server_id, '2.0.0');

  // Walk to active
  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ] as [string, string][]) {
    const id = engine1.startTransition(server_id, client_id, from as any, to as any, null);
    engine1.confirmTransition(id, manifestV1);
  }
  strictEqual(engine1.getState(server_id, client_id), 'active');

  // Begin update: active -> reviewed. This commits the intent AND a checkpoint
  // (of the active/v1 state) atomically, in one transaction - this is the real
  // guarantee under test. Simulate the "side effect" as a no-op we never await
  // to completion (nothing to interrupt mid-flight since Phase C has no real I/O
  // yet - the process simply dies here, before confirmTransition is ever called).
  const intentId = engine1.startTransition(server_id, client_id, 'active', 'reviewed', null, [
    'write_client_config', // simulated Phase F side effect name, never executed
  ]);
  ok(intentId > 0);

  // Confirm the checkpoint was committed atomically with the intent
  const intentRow = db1.prepare('SELECT checkpoint_id FROM lifecycle_events WHERE id = ?').get(intentId) as {
    checkpoint_id: number;
  };
  ok(intentRow.checkpoint_id, 'checkpoint was created atomically with the intent');

  // *** Process dies here. *** confirmTransition() is never called.
  db1.close();

  // Simulate restart: brand-new engine instance over the same db file
  const db2 = openDatabase(dbPath);
  const engine2 = new LifecycleEngine(db2);
  engine2.onStartup();

  // Recovery must have restored the lockfile to the checkpoint (v1, active) -
  // NOT left it in 'reviewed' with v2, which never got confirmed.
  strictEqual(engine2.getState(server_id, client_id), 'active', 'recovery restores active state from checkpoint');
  const entry = db2
    .prepare('SELECT manifest_id FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
    .get(server_id, client_id) as { manifest_id: number };
  strictEqual(entry.manifest_id, manifestV1, 'recovery restores v1 manifest, not the unconfirmed v2');

  // The intent must now show as resolved
  const unresolved = engine2.getUnresolvedIntent(server_id, client_id);
  strictEqual(unresolved, null, 'intent is resolved after recovery');

  // A recovery event should exist, correlated back to the original intent
  const events = engine2.getEvents(server_id, client_id);
  const recoveryEvent = events.find((e) => e.event_type === 'recovery' && e.resolves_intent_id === intentId);
  ok(recoveryEvent, 'a recovery event correlated to the original intent was recorded');

  db2.close();
});

test('Crash point 3: kill during a non-away-from-active transition (no checkpoint case)', () => {
  const dbPath = freshDbPath();
  const db1 = openDatabase(dbPath);
  const engine1 = new LifecycleEngine(db1);
  seedManifest(db1, 'test-server', '1.0.0');

  // discovered -> reviewed never creates a checkpoint (only away-from-active does)
  const intentId = engine1.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null);
  const intentRow = db1.prepare('SELECT checkpoint_id FROM lifecycle_events WHERE id = ?').get(intentId) as {
    checkpoint_id: number | null;
  };
  strictEqual(intentRow.checkpoint_id, null, 'no checkpoint created for a non-away-from-active transition');

  // *** Process dies here, before confirmTransition. lockfile_entries was never touched. ***
  db1.close();

  const db2 = openDatabase(dbPath);
  const engine2 = new LifecycleEngine(db2);
  engine2.onStartup();

  // No lockfile_entries row exists at all (this was the server's very first transition),
  // and recovery must not have tried to create one or error out.
  const state = engine2.getState('test-server', 'claude-code');
  strictEqual(state, null, 'lockfile_entries was never touched; still no row for this pair');

  // Recovery event recorded: to_state === from_state, meaning "no change needed"
  const events = engine2.getEvents('test-server', 'claude-code');
  const recoveryEvent = events.find((e) => e.event_type === 'recovery');
  ok(recoveryEvent, 'recovery event was written for the abandoned intent');
  strictEqual(recoveryEvent!.from_state, 'discovered');
  strictEqual(recoveryEvent!.to_state, 'discovered', 'to_state equals from_state: no-op recovery, not an error path');

  // Confirm this is NOT the manual-intervention/error path: no error_message set
  strictEqual(recoveryEvent!.error_message, null, 'no-checkpoint recovery is not an error condition in Phase C');

  // The pair is now free to retry the transition
  const retryIntent = engine2.startTransition('test-server', 'claude-code', 'discovered', 'reviewed', null);
  ok(retryIntent > 0, 'transition can be retried after recovery');

  db2.close();
});

test('Crash point 4: recovery is idempotent under a repeated/interrupted restart', () => {
  const dbPath = freshDbPath();
  const db1 = openDatabase(dbPath);
  const engine1 = new LifecycleEngine(db1);
  const server_id = 'test-server';
  const client_id = 'claude-code';
  const manifestV1 = seedManifest(db1, server_id, '1.0.0');
  seedManifest(db1, server_id, '2.0.0');

  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ] as [string, string][]) {
    const id = engine1.startTransition(server_id, client_id, from as any, to as any, null);
    engine1.confirmTransition(id, manifestV1);
  }

  // Begin an update, crash before confirm (checkpoint created)
  const intentId = engine1.startTransition(server_id, client_id, 'active', 'reviewed', null);
  db1.close();

  // First restart: recovery runs and resolves it (simulates recovery itself being
  // interrupted immediately after restoring but the process is killed again right
  // after - so a SECOND restart runs onStartup a second time over the same,
  // now-already-resolved intent)
  const db2 = openDatabase(dbPath);
  const engine2 = new LifecycleEngine(db2);
  engine2.onStartup();
  strictEqual(engine2.getState(server_id, client_id), 'active', 'first recovery restores active');
  db2.close();

  // Second restart: onStartup runs again. Must be idempotent - no double-restore,
  // no duplicate recovery event, no error.
  const db3 = openDatabase(dbPath);
  const engine3 = new LifecycleEngine(db3);
  engine3.onStartup();
  strictEqual(engine3.getState(server_id, client_id), 'active', 'second recovery run is a safe no-op');

  const events = engine3.getEvents(server_id, client_id);
  const recoveryEvents = events.filter((e) => e.event_type === 'recovery' && e.resolves_intent_id === intentId);
  strictEqual(recoveryEvents.length, 1, 'the intent was only recovered once, not double-processed');

  db3.close();
});
