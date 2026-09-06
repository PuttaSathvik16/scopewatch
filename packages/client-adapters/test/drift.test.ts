import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { activateForClient } from '../src/activate.js';
import { claudeCodeConfigPath, CLAUDE_CODE_CLIENT_ID } from '../src/claude-code-adapter.js';
import { detectDriftForPair, detectAllDrift } from '../src/drift.js';

function setupActivatedServer(projectRoot: string, dbPath: string, server_id: string, client_id = CLAUDE_CODE_CLIENT_ID) {
  const db = openDatabase(dbPath);
  const manifestId = insertManifest(db, server_id, '1.0.0', 'npm', server_id, 'sha256:test', '{}');
  const engine = new LifecycleEngine(db);
  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
    ['installed', 'configured'],
    ['configured', 'validated'],
    ['validated', 'active'],
  ] as [string, string][]) {
    const id = engine.startTransition(server_id, client_id, from as any, to as any, null);
    engine.confirmTransition(id, manifestId);
  }
  activateForClient(db, server_id, client_id, projectRoot);
  return db;
}

test('detectDriftForPair: unchanged - live config matches the stored snapshot exactly', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'unchanged-server');

  try {
    const result = detectDriftForPair(db, 'unchanged-server', CLAUDE_CODE_CLIENT_ID);
    ok(result.ok);
    if (result.ok) strictEqual(result.entry.status, 'unchanged');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectDriftForPair: changed - a hand-edit to the owned entry is detected with correct snapshot/live values', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'changed-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['changed-server'].args = ['changed-server', 'claude-code', '--extra-flag'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = detectDriftForPair(db, 'changed-server', CLAUDE_CODE_CLIENT_ID);
    ok(result.ok);
    if (result.ok) {
      strictEqual(result.entry.status, 'changed');
      deepStrictEqual(result.entry.liveValue, { command: 'scopewatch-run', args: ['changed-server', 'claude-code', '--extra-flag'] });
      deepStrictEqual(result.entry.storedSnapshot, { command: 'scopewatch-run', args: ['changed-server', 'claude-code'] });
    }
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectDriftForPair: missing - the owned key was deleted entirely (file still valid JSON)', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'missing-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    delete config.mcpServers['missing-server'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = detectDriftForPair(db, 'missing-server', CLAUDE_CODE_CLIENT_ID);
    ok(result.ok);
    if (result.ok) {
      strictEqual(result.entry.status, 'missing');
      strictEqual(result.entry.liveValue, undefined);
      ok(result.entry.storedSnapshot);
    }
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectAllDrift: a human-added unrelated entry is never touched or reported, only owned keys are checked', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'owned-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['human-tool'] = { command: 'python', args: ['tool.py'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const results = detectAllDrift(db);
    strictEqual(results.length, 1, 'only the owned entry is checked, never the human-added one');
    strictEqual(results[0]!.server_id, 'owned-server');

    // Confirm the human entry is still there, untouched, after detection ran
    const configAfter = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(configAfter.mcpServers['human-tool'], { command: 'python', args: ['tool.py'] });
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectDriftForPair: malformed structure - mcpServers is a string, not an object -> malformed_config_structure error, not forced classification', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'malformed-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    writeFileSync(configPath, JSON.stringify({ mcpServers: 'this should be an object' }));

    const result = detectDriftForPair(db, 'malformed-server', CLAUDE_CODE_CLIENT_ID);
    strictEqual(result.ok, false);
    if (!result.ok) {
      strictEqual(result.error.category, 'malformed_config_structure');
      ok(result.error.message.includes('mcpServers'));
    }
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectDriftForPair: unparseable JSON -> malformed_config_structure error, not a crash', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'broken-json-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    writeFileSync(configPath, '{ this is not valid json,,, ]');

    const result = detectDriftForPair(db, 'broken-json-server', CLAUDE_CODE_CLIENT_ID);
    strictEqual(result.ok, false);
    if (!result.ok) strictEqual(result.error.category, 'malformed_config_structure');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('detectAllDrift: independent detection across two clients for the same server (closing the loop with Phase F golden-path)', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const manifestId = insertManifest(db, 'multi-client-server', '1.0.0', 'npm', 'multi-client-server', 'sha256:test', '{}');

  try {
    for (const client_id of [CLAUDE_CODE_CLIENT_ID, 'cursor']) {
      const engine = new LifecycleEngine(db);
      for (const [from, to] of [
        ['discovered', 'reviewed'],
        ['reviewed', 'installed'],
        ['installed', 'configured'],
        ['configured', 'validated'],
        ['validated', 'active'],
      ] as [string, string][]) {
        const id = engine.startTransition('multi-client-server', client_id, from as any, to as any, null);
        engine.confirmTransition(id, manifestId);
      }
      activateForClient(db, 'multi-client-server', client_id, projectRoot);
    }

    // Drift only Claude Code's copy
    const claudeConfigPath = claudeCodeConfigPath(projectRoot);
    const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
    delete claudeConfig.mcpServers['multi-client-server'];
    writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig));

    const results = detectAllDrift(db);
    strictEqual(results.length, 2);

    const claudeResult = results.find((r) => r.client_id === CLAUDE_CODE_CLIENT_ID)!;
    const cursorResult = results.find((r) => r.client_id === 'cursor')!;
    ok(claudeResult.result.ok && claudeResult.result.entry.status === 'missing');
    ok(cursorResult.result.ok && cursorResult.result.entry.status === 'unchanged', "cursor's copy must be unaffected by claude's drift");
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// --- The explicitly-required 'unverifiable' fixture ---

test('UNVERIFIABLE CASE: a pre-migration ownership row (no real snapshot) reports unverifiable, not changed', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-drift-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const manifestId = insertManifest(db, 'pre-migration-server', '1.0.0', 'npm', 'pre-migration-server', 'sha256:test', '{}');

  try {
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('pre-migration-server', CLAUDE_CODE_CLIENT_ID, from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    const configPath = claudeCodeConfigPath(projectRoot);
    // Simulate a config file that was written BEFORE last_written_value existed:
    // a real, working entry on disk, but no real snapshot recorded in the DB.
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { 'pre-migration-server': { command: 'scopewatch-run', args: ['pre-migration-server', 'claude-code'] } } })
    );
    // Directly insert an ownership row the way migration 004's backfill does:
    // last_written_value is NULL, simulating a pre-existing row that predates snapshots.
    db.prepare(
      `INSERT INTO client_config_ownership (server_id, client_id, config_file_path, config_key, last_written_value, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run('pre-migration-server', CLAUDE_CODE_CLIENT_ID, configPath, 'pre-migration-server', Math.floor(Date.now() / 1000));

    const result = detectDriftForPair(db, 'pre-migration-server', CLAUDE_CODE_CLIENT_ID);
    ok(result.ok);
    if (result.ok) {
      strictEqual(result.entry.status, 'unverifiable', 'must be unverifiable, not changed - there is no real snapshot to compare against');
      strictEqual(result.entry.storedSnapshot, undefined, 'no real snapshot exists to report');
      ok(result.entry.liveValue, 'the real live value should still be reported for context');
    }
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
