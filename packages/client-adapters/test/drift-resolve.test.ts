import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { activateForClient } from '../src/activate.js';
import { claudeCodeConfigPath, CLAUDE_CODE_CLIENT_ID } from '../src/claude-code-adapter.js';
import { detectDriftForPair } from '../src/drift.js';
import { resolveDriftEntry, validResolutionsFor } from '../src/drift-resolve.js';

function setupActivatedServer(projectRoot: string, dbPath: string, server_id: string) {
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
    const id = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, from as any, to as any, null);
    engine.confirmTransition(id, manifestId);
  }
  activateForClient(db, server_id, CLAUDE_CODE_CLIENT_ID, projectRoot);
  return db;
}

test('validResolutionsFor: unverifiable never offers restore - the whole point of this fix', () => {
  const valid = validResolutionsFor('unverifiable');
  ok(!valid.includes('restore'), 'restore must never be offered for unverifiable - there is nothing real to restore to');
  ok(valid.includes('keep'));
});

test('resolveDriftEntry: changed + keep -> snapshot updates to the live value; re-detecting reports unchanged', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'keep-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['keep-server'].args.push('--new-flag');
    writeFileSync(configPath, JSON.stringify(config));

    const detected = detectDriftForPair(db, 'keep-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'changed');
    if (!detected.ok) return;

    const resolveResult = resolveDriftEntry(db, detected.entry, 'keep');
    ok(resolveResult.ok);

    const redetected = detectDriftForPair(db, 'keep-server', CLAUDE_CODE_CLIENT_ID);
    ok(redetected.ok && redetected.entry.status === 'unchanged', 're-detection after "keep" must report unchanged');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('resolveDriftEntry: changed + restore -> the file reverts to the snapshot, unrelated entries untouched', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'restore-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['restore-server'].args.push('--hand-edited');
    config.mcpServers['human-tool'] = { command: 'python', args: ['x.py'] };
    writeFileSync(configPath, JSON.stringify(config));

    const detected = detectDriftForPair(db, 'restore-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'changed');
    if (!detected.ok) return;

    const resolveResult = resolveDriftEntry(db, detected.entry, 'restore');
    ok(resolveResult.ok);

    const finalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(finalConfig.mcpServers['restore-server'], { command: 'scopewatch-run', args: ['restore-server', 'claude-code'] });
    deepStrictEqual(finalConfig.mcpServers['human-tool'], { command: 'python', args: ['x.py'] }, 'unrelated human entry must survive a restore');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('resolveDriftEntry: missing + keep -> real active->disabled transition fires, status reflects it', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'disable-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    delete config.mcpServers['disable-server'];
    writeFileSync(configPath, JSON.stringify(config));

    const detected = detectDriftForPair(db, 'disable-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'missing');
    if (!detected.ok) return;

    const resolveResult = resolveDriftEntry(db, detected.entry, 'keep');
    ok(resolveResult.ok, `expected success, got: ${!resolveResult.ok && resolveResult.error.message}`);

    const state = db
      .prepare('SELECT state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get('disable-server', CLAUDE_CODE_CLIENT_ID) as { state: string };
    strictEqual(state.state, 'disabled', 'keeping a removal must transition lifecycle state to disabled via the real engine');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('resolveDriftEntry: missing + restore -> key is re-written from the snapshot, state remains active', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'restore-missing-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    delete config.mcpServers['restore-missing-server'];
    writeFileSync(configPath, JSON.stringify(config));

    const detected = detectDriftForPair(db, 'restore-missing-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'missing');
    if (!detected.ok) return;

    const resolveResult = resolveDriftEntry(db, detected.entry, 'restore');
    ok(resolveResult.ok);

    const finalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    ok(finalConfig.mcpServers['restore-missing-server'], 'the key should be re-written');

    const state = db
      .prepare('SELECT state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get('restore-missing-server', CLAUDE_CODE_CLIENT_ID) as { state: string };
    strictEqual(state.state, 'active', 'restoring the missing key must leave state as active');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('resolveDriftEntry: skip -> no file write, no state change, still flagged on next detection', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = setupActivatedServer(projectRoot, dbPath, 'skip-server');

  try {
    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['skip-server'].args.push('--edited');
    const beforeContent = JSON.stringify(config);
    writeFileSync(configPath, beforeContent);

    const detected = detectDriftForPair(db, 'skip-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'changed');
    if (!detected.ok) return;

    const resolveResult = resolveDriftEntry(db, detected.entry, 'skip');
    ok(resolveResult.ok);

    const afterContent = readFileSync(configPath, 'utf-8');
    strictEqual(afterContent, beforeContent, 'skip must not touch the file at all');

    const redetected = detectDriftForPair(db, 'skip-server', CLAUDE_CODE_CLIENT_ID);
    ok(redetected.ok && redetected.entry.status === 'changed', 'entry must still be flagged as changed after skip');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// --- The explicitly-required unverifiable-restore-refused fixture ---

test('UNVERIFIABLE CASE: resolveDriftEntry refuses "restore" for an unverifiable entry with a clear error', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-resolve-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const manifestId = insertManifest(db, 'unverifiable-resolve-server', '1.0.0', 'npm', 'unverifiable-resolve-server', 'sha256:test', '{}');

  try {
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('unverifiable-resolve-server', CLAUDE_CODE_CLIENT_ID, from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    const configPath = claudeCodeConfigPath(projectRoot);
    const realLiveEntry = { command: 'scopewatch-run', args: ['unverifiable-resolve-server', 'claude-code'] };
    writeFileSync(configPath, JSON.stringify({ mcpServers: { 'unverifiable-resolve-server': realLiveEntry } }));
    db.prepare(
      `INSERT INTO client_config_ownership (server_id, client_id, config_file_path, config_key, last_written_value, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run('unverifiable-resolve-server', CLAUDE_CODE_CLIENT_ID, configPath, 'unverifiable-resolve-server', Math.floor(Date.now() / 1000));

    const detected = detectDriftForPair(db, 'unverifiable-resolve-server', CLAUDE_CODE_CLIENT_ID);
    ok(detected.ok && detected.entry.status === 'unverifiable');
    if (!detected.ok) return;

    // Attempting 'restore' must be refused with a clear error, not silently
    // do something destructive or silently no-op.
    const restoreAttempt = resolveDriftEntry(db, detected.entry, 'restore');
    strictEqual(restoreAttempt.ok, false);
    if (!restoreAttempt.ok) {
      ok(restoreAttempt.error.message.includes('nothing to restore') || restoreAttempt.error.message.includes('not a valid resolution'));
    }

    // Confirm the REAL file on disk was NOT touched/blanked by the refused attempt
    const configAfter = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(configAfter.mcpServers['unverifiable-resolve-server'], realLiveEntry, "the user's real config entry must survive a refused restore attempt untouched");

    // 'keep' (adopt current live value as new baseline) must succeed
    const keepResult = resolveDriftEntry(db, detected.entry, 'keep');
    ok(keepResult.ok);

    const redetected = detectDriftForPair(db, 'unverifiable-resolve-server', CLAUDE_CODE_CLIENT_ID);
    ok(redetected.ok && redetected.entry.status === 'unchanged', 'after adopting the live value as baseline, re-detection should report unchanged');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
