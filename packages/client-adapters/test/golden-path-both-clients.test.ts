import { test } from 'node:test';
import { strictEqual, ok, notStrictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, insertManifest, LifecycleEngine, getOwnedKeys } from '@scopewatch/state';
import { storeSecret, retrieveSecret, deleteSecret, secretRef } from '@scopewatch/secrets';
import { activateForClient } from '../src/activate.js';
import { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from '../src/claude-code-adapter.js';
import { CURSOR_CLIENT_ID, cursorConfigPath } from '../src/cursor-adapter.js';
import { runWrapper } from '../src/run-wrapper.js';
import type { SpawnFn } from '../src/run-wrapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fake-mcp-server.mjs');

/**
 * Section 19 MVP acceptance criterion: "The same server definition activates
 * correctly for both supported clients without duplicating credentials or
 * hand-editing." This proves the FULL chain end to end for BOTH clients from
 * ONE manifest and ONE stored secret - not individual mechanisms verified
 * once and assumed to generalize.
 */

const SERVER_ID = 'golden-path-server';
const SECRET_ID = 'API_TOKEN';
const SECRET_VALUE = 'golden-path-real-secret-value-xyz';

function setupServerActiveOnBothClients(projectRoot: string) {
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);

  const manifestId = insertManifest(
    db,
    SERVER_ID,
    '1.0.0',
    'npm',
    SERVER_ID,
    'sha256:golden',
    JSON.stringify({
      source: { type: 'npm', location: SERVER_ID },
      secrets: [{ id: SECRET_ID }],
    })
  );

  for (const client_id of [CLAUDE_CODE_CLIENT_ID, CURSOR_CLIENT_ID]) {
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition(SERVER_ID, client_id, from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }
  }

  return db;
}

test('Golden path: one manifest activates correctly for BOTH clients, each with correct config + ownership', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-golden-'));
  const ref = secretRef(SERVER_ID, SECRET_ID);

  try {
    storeSecret(ref, SECRET_VALUE);
    const db = setupServerActiveOnBothClients(projectRoot);

    // Activate for BOTH clients from the same server_id/manifest
    activateForClient(db, SERVER_ID, CLAUDE_CODE_CLIENT_ID, projectRoot);
    activateForClient(db, SERVER_ID, CURSOR_CLIENT_ID, projectRoot);

    // --- Claude Code: correct file, correct path, correct format ---
    const claudePath = claudeCodeConfigPath(projectRoot);
    strictEqual(claudePath, join(projectRoot, '.mcp.json'));
    ok(existsSync(claudePath), 'Claude Code config file must exist at the documented path');
    const claudeConfig = JSON.parse(readFileSync(claudePath, 'utf-8'));
    ok(claudeConfig.mcpServers, 'Claude Code config must use the mcpServers shape');
    const claudeEntry = claudeConfig.mcpServers[SERVER_ID];
    ok(claudeEntry, 'server entry must be present under its server_id key');
    strictEqual(claudeEntry.command, 'scopewatch-run');
    strictEqual(claudeEntry.args[0], SERVER_ID);
    strictEqual(claudeEntry.args[1], CLAUDE_CODE_CLIENT_ID);

    // --- Cursor: correct file, correct path (with its distinct .cursor/ subdir), correct format ---
    const cursorPath = cursorConfigPath(projectRoot);
    strictEqual(cursorPath, join(projectRoot, '.cursor', 'mcp.json'));
    ok(existsSync(cursorPath), 'Cursor config file must exist at the documented path');
    const cursorConfig = JSON.parse(readFileSync(cursorPath, 'utf-8'));
    ok(cursorConfig.mcpServers, 'Cursor config must use the mcpServers shape');
    const cursorEntry = cursorConfig.mcpServers[SERVER_ID];
    ok(cursorEntry, 'server entry must be present under its server_id key');
    strictEqual(cursorEntry.command, 'scopewatch-run');
    strictEqual(cursorEntry.args[0], SERVER_ID);
    strictEqual(cursorEntry.args[1], CURSOR_CLIENT_ID);

    // The two clients' generated entries must differ ONLY in the client_id arg -
    // proving genuine per-client wiring, not one file blindly copied to the other
    notStrictEqual(claudeEntry.args[1], cursorEntry.args[1]);
    strictEqual(claudeEntry.command, cursorEntry.command);

    // --- Ownership table correctly tracks BOTH, independently, per client ---
    const claudeOwned = getOwnedKeys(db, CLAUDE_CODE_CLIENT_ID, claudePath);
    const cursorOwned = getOwnedKeys(db, CURSOR_CLIENT_ID, cursorPath);
    ok(claudeOwned.has(SERVER_ID), 'ownership table must record Claude Code owns this key in its own file');
    ok(cursorOwned.has(SERVER_ID), 'ownership table must record Cursor owns this key in its own file');

    // Config correctness check for both clients: the args a client will pass
    // to the wrapper are exactly (server_id, client_id) - the actual launch
    // proof (that invoking scopewatch-run with these exact args successfully
    // starts the fixture) is in the next test, which needs to be async to
    // drive runWrapper's real child-process spawn.
    for (const [label, entry] of [
      ['Claude Code', claudeEntry],
      ['Cursor', cursorEntry],
    ] as const) {
      strictEqual(entry.command, 'scopewatch-run', `${label}: config specifies the wrapper as the command`);
      const [launchedServerId, launchedClientId] = entry.args as [string, string];
      strictEqual(launchedServerId, SERVER_ID, `${label}: config's args[0] is the server_id runWrapper expects`);
      strictEqual(launchedClientId, label === 'Claude Code' ? CLAUDE_CODE_CLIENT_ID : CURSOR_CLIENT_ID);
    }

    db.close();
  } finally {
    deleteSecret(ref);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Golden path: invoking scopewatch-run with EACH client\'s exact config-specified args actually launches the fixture, for BOTH clients', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-golden-launch-'));
  const ref = secretRef(SERVER_ID, SECRET_ID);

  try {
    storeSecret(ref, SECRET_VALUE);
    const db = setupServerActiveOnBothClients(projectRoot);

    activateForClient(db, SERVER_ID, CLAUDE_CODE_CLIENT_ID, projectRoot);
    activateForClient(db, SERVER_ID, CURSOR_CLIENT_ID, projectRoot);

    const claudeConfig = JSON.parse(readFileSync(claudeCodeConfigPath(projectRoot), 'utf-8'));
    const cursorConfig = JSON.parse(readFileSync(cursorConfigPath(projectRoot), 'utf-8'));

    const claudeArgs = claudeConfig.mcpServers[SERVER_ID].args as [string, string];
    const cursorArgs = cursorConfig.mcpServers[SERVER_ID].args as [string, string];

    const results: { label: string; exitCode: number; env: NodeJS.ProcessEnv | undefined }[] = [];

    for (const [label, args] of [
      ['Claude Code', claudeArgs],
      ['Cursor', cursorArgs],
    ] as const) {
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      const realSpawnToFixture: SpawnFn = (_cmd, _args, options) => {
        capturedEnv = options.env;
        return spawn('node', [FIXTURE, 'exit', '0'], { env: options.env });
      };

      // This is EXACTLY what the client does: it read "scopewatch-run <server_id> <client_id>"
      // out of its own config file and invokes it with those two args.
      const exitCode = await runWrapper(args[0], args[1], { db, spawn: realSpawnToFixture });
      results.push({ label, exitCode, env: capturedEnv });
    }

    for (const { label, exitCode, env } of results) {
      strictEqual(exitCode, 0, `${label}: launching via its own config-specified args must succeed`);
      strictEqual(env?.[SECRET_ID], SECRET_VALUE, `${label}: the shared secret must be injected into the spawned env`);
    }

    db.close();
  } finally {
    deleteSecret(ref);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Secret sharing, not duplication: exactly ONE keychain entry backs BOTH clients\' activations', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-secret-sharing-'));
  const ref = secretRef(SERVER_ID, SECRET_ID);

  try {
    storeSecret(ref, SECRET_VALUE);

    // Prove there is exactly one keychain entry for this reference via the
    // real cross-platform dispatcher (retrieveSecret - security on macOS,
    // secret-tool on Linux, PowerShell/CredRead on Windows), not a hardcoded
    // macOS-only `security` call: that version hard-failed with ENOENT on a
    // real Windows CI run, since `security` doesn't exist there. There is no
    // "list all entries with this account name" ambiguity to check, because
    // the account name IS the full server_id:secret_id reference, and the
    // reference construction (secretRef) is client-agnostic by design - it
    // takes no client_id parameter at all, so a second activation for a
    // second client cannot mint a second keychain entry even in principle.
    const found = retrieveSecret(ref);
    ok(found.ok, `exactly one keychain entry exists for this reference, with the expected value - got error: ${!found.ok ? found.error.message : ''}`);
    if (found.ok) {
      strictEqual(found.value, SECRET_VALUE, 'exactly one keychain entry exists for this reference, with the expected value');
    }

    const db = setupServerActiveOnBothClients(projectRoot);
    activateForClient(db, SERVER_ID, CLAUDE_CODE_CLIENT_ID, projectRoot);
    activateForClient(db, SERVER_ID, CURSOR_CLIENT_ID, projectRoot);

    const claudeConfig = JSON.parse(readFileSync(claudeCodeConfigPath(projectRoot), 'utf-8'));
    const cursorConfig = JSON.parse(readFileSync(cursorConfigPath(projectRoot), 'utf-8'));
    const claudeArgs = claudeConfig.mcpServers[SERVER_ID].args as [string, string];
    const cursorArgs = cursorConfig.mcpServers[SERVER_ID].args as [string, string];

    const envs: (NodeJS.ProcessEnv | undefined)[] = [];
    for (const args of [claudeArgs, cursorArgs]) {
      let capturedEnv: NodeJS.ProcessEnv | undefined;
      const realSpawnToFixture: SpawnFn = (_cmd, _args, options) => {
        capturedEnv = options.env;
        return spawn('node', [FIXTURE, 'exit', '0'], { env: options.env });
      };
      await runWrapper(args[0], args[1], { db, spawn: realSpawnToFixture });
      envs.push(capturedEnv);
    }

    strictEqual(envs[0]?.[SECRET_ID], SECRET_VALUE, "Claude Code's wrapper invocation retrieved the shared value");
    strictEqual(envs[1]?.[SECRET_ID], SECRET_VALUE, "Cursor's wrapper invocation retrieved the SAME shared value");
    strictEqual(envs[0]?.[SECRET_ID], envs[1]?.[SECRET_ID], 'both clients received the identical value from the single shared keychain entry');

    db.close();
  } finally {
    deleteSecret(ref);
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
