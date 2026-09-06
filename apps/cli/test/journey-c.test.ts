import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { activateForClient, claudeCodeConfigPath, CLAUDE_CODE_CLIENT_ID } from '@scopewatch/client-adapters';
import * as cmds from '../src/commands.js';

/**
 * Journey C, run as a real scripted sequence: activate for real -> a human
 * hand-edits the real client config file -> `drift --all-clients` (report,
 * read-only) finds the mismatch and shows the specific entry, not a silent
 * overwrite -> `drift --resolve` (real, built now, not deferred) applies the
 * user's actual choice. Not isolated per-function unit tests standing in
 * for the journey.
 */

test('Journey C end-to-end: activate -> hand-edit -> drift report -> drift resolve (restore)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-journey-c-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'journey-c-server';

  try {
    // --- Setup: a server genuinely activated for real, via the real pipeline pieces ---
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

    const configPath = claudeCodeConfigPath(projectRoot);
    const originalEntry = JSON.parse(readFileSync(configPath, 'utf-8')).mcpServers[server_id];
    ok(originalEntry, 'sanity: activation really wrote the entry');

    // --- A human hand-edits the real file (not a simulated in-memory change) ---
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers[server_id].args.push('--human-added-flag');
    config.mcpServers['unrelated-human-tool'] = { command: 'python', args: ['their_own_thing.py'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // --- drift --all-clients: report only, must find the real mismatch ---
    const report = cmds.cmdDrift({ db });
    strictEqual(report.length, 1, 'only the owned entry is reported, never the unrelated human tool');
    const reportedEntry = report[0]!;
    ok(reportedEntry.result.ok);
    if (reportedEntry.result.ok) {
      strictEqual(reportedEntry.result.entry.status, 'changed');
      strictEqual(reportedEntry.server_id, server_id);
    }

    // Confirm the report itself did NOT write anything - purely read-only
    const configAfterReport = readFileSync(configPath, 'utf-8');
    ok(configAfterReport.includes('--human-added-flag'), 'reporting must not have reverted the hand-edit');
    ok(configAfterReport.includes('unrelated-human-tool'), 'reporting must not have touched the unrelated entry');

    // --- drift --resolve: the user is offered a real choice and it is applied ---
    const resolveResult = await cmds.cmdDriftResolve({
      db,
      promptChoice: async (entry) => {
        strictEqual(entry.server_id, server_id, 'the prompt must be for the real drifted entry');
        strictEqual(entry.status, 'changed');
        return 'restore'; // the user chooses to discard the hand-edit and restore Scopewatch's version
      },
    });
    ok(resolveResult.ok);
    if (resolveResult.ok) strictEqual(resolveResult.resolved, 1);

    // --- Confirm the REAL file reflects the real choice ---
    const finalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(finalConfig.mcpServers[server_id], originalEntry, "restoring must revert to exactly what was originally activated");
    deepStrictEqual(
      finalConfig.mcpServers['unrelated-human-tool'],
      { command: 'python', args: ['their_own_thing.py'] },
      "the unrelated human tool must survive the entire journey untouched"
    );

    // --- Re-running drift now reports unchanged - the loop actually closes ---
    const finalReport = cmds.cmdDrift({ db });
    ok(finalReport[0]!.result.ok && finalReport[0]!.result.entry.status === 'unchanged');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Journey C, removal branch: activate -> human deletes the entry -> drift resolve (keep removal) -> real active->disabled transition', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-journey-c-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'journey-c-removal-server';

  try {
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

    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    delete config.mcpServers[server_id];
    writeFileSync(configPath, JSON.stringify(config));

    const resolveResult = await cmds.cmdDriftResolve({
      db,
      promptChoice: async (entry) => {
        strictEqual(entry.status, 'missing');
        return 'keep'; // the user confirms: yes, this server is really gone from this client
      },
    });
    ok(resolveResult.ok);
    if (resolveResult.ok) strictEqual(resolveResult.resolved, 1);

    const statusRows = cmds.cmdStatus({ db }) as any[];
    const entry = statusRows.find((r) => r.server_id === server_id);
    strictEqual(entry.state, 'disabled', "status must reflect reality: this pair is no longer actually active in the client");
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
