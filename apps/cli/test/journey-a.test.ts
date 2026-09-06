import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@scopewatch/state';
import { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from '@scopewatch/client-adapters';
import { deleteSecret, secretRef, retrieveSecret } from '@scopewatch/secrets';
import * as cmds from '../src/commands.js';
import type { RegistryServer, FetchFn } from '../src/registry-client.js';
import type { SpawnFn as McpSpawnFn } from '../src/mcp-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SERVER = join(__dirname, 'fixtures', 'fake-real-mcp-server.mjs');

/**
 * Journey A, run as a real scripted sequence of actual CLI command functions
 * against a fixtured registry and a fixtured (but protocol-real) MCP server -
 * not isolated per-command unit tests standing in for the journey. This is
 * the first time the full pipeline (registry data, real inferred
 * capabilities, the diff engine, the lifecycle engine, secrets, and a
 * client adapter) runs together as one path.
 *
 * search -> info -> install -> test -> activate -> (weeks later) update
 * --check -> diff -> approve
 */

const SERVER_NAME = 'io.github.test/journey-a-server';
const SECRET_VALUE = 'journey-a-fixture-secret-value';

function fakeRegistryServer(version: string): RegistryServer {
  return {
    name: SERVER_NAME,
    description: 'A fixture server for Journey A end-to-end testing.',
    version,
    packages: [
      {
        registryType: 'npm',
        identifier: 'journey-a-fixture-package',
        version,
        transport: { type: 'stdio' },
        environmentVariables: [{ name: 'JOURNEY_A_TOKEN', description: 'Fixture API token', isRequired: true }],
      },
    ],
    repository: { url: 'https://github.com/test/journey-a-server', source: 'github' },
  };
}

function makeFakeFetch(version: string): FetchFn {
  return (async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes('/versions/')) {
      return new Response(JSON.stringify({ server: fakeRegistryServer(version) }), { status: 200 });
    }
    if (urlStr.includes('?search=')) {
      return new Response(
        JSON.stringify({ servers: [{ server: fakeRegistryServer(version) }], metadata: { count: 1 } }),
        { status: 200 }
      );
    }
    return new Response('not found', { status: 404 });
  }) as FetchFn;
}

function fixtureMcpSpawn(fixtureVersion: 'v1' | 'v2'): McpSpawnFn {
  return (_command, _args, env) =>
    spawn('node', [FIXTURE_SERVER], { env: { ...env, SCOPEWATCH_FIXTURE_VERSION: fixtureVersion }, stdio: ['pipe', 'pipe', 'pipe'] });
}

test('Journey A end-to-end: search -> info -> install -> test -> activate -> update-check -> diff -> approve', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-journey-a-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const secretReference = secretRef(SERVER_NAME, 'JOURNEY_A_TOKEN');

  const fakePrereqRunner = (command: string) => (command === 'node' ? 'v22.5.0\n' : '10.8.2\n');
  const fakeInstallRunner = () => ({ code: 0, stdout: 'added 1 package', stderr: '' });

  try {
    // --- Step 1: search ---
    const searchResult = await cmds.cmdSearch('journey-a', { db, fetchFn: makeFakeFetch('1.0.0') });
    ok(searchResult.ok, 'search should succeed');
    if (searchResult.ok) {
      strictEqual(searchResult.result.servers[0]!.name, SERVER_NAME, 'search should find the fixture server');
    }

    // --- Step 2: info ---
    const infoResult = await cmds.cmdInfo(SERVER_NAME, { db, fetchFn: makeFakeFetch('1.0.0') });
    ok(infoResult.ok, 'info should succeed');
    if (infoResult.ok) {
      strictEqual(infoResult.server.version, '1.0.0');
    }

    // --- Step 3: install (real pipeline: registry -> manifest with REAL inferred
    // capabilities from a real MCP handshake -> lifecycle transitions -> secret prompt) ---
    let promptedMessage = '';
    const installResult = await cmds.cmdInstall(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, {
      db,
      fetchFn: makeFakeFetch('1.0.0'),
      prereqRunner: fakePrereqRunner,
      installRunner: fakeInstallRunner,
      mcpSpawnFn: fixtureMcpSpawn('v1'),
      promptFn: async (message: string) => {
        promptedMessage = message;
        return SECRET_VALUE;
      },
    });

    ok(installResult.ok, `install should succeed, got: ${JSON.stringify(!installResult.ok && installResult)}`);
    if (installResult.ok) {
      // Real inferred capabilities, not a placeholder: v1 fixture has one read
      // tool and one destructive write tool - confirm the inference actually ran.
      const readCap = installResult.manifest.capabilities.find((c) => c.tool_id === 'read_record');
      const writeCap = installResult.manifest.capabilities.find((c) => c.tool_id === 'write_record');
      ok(readCap, 'manifest should have a capability for read_record');
      ok(writeCap, 'manifest should have a capability for write_record');
      strictEqual(readCap!.verb, 'read', 'real inference should classify read_record as read');
      strictEqual(writeCap!.verb, 'write', 'real inference should classify write_record as write');
      strictEqual(readCap!.provenance, 'inferred');
    }
    ok(promptedMessage.includes('JOURNEY_A_TOKEN'), 'the secret prompt should have asked for the declared required secret');

    // Confirm the secret was actually stored in the real keychain
    const storedSecret = retrieveSecret(secretReference);
    ok(storedSecret.ok, 'the prompted secret should have been stored in the real keychain');
    if (storedSecret.ok) strictEqual(storedSecret.value, SECRET_VALUE);

    // Confirm lifecycle state actually advanced to 'validated'
    const statusAfterInstall = cmds.cmdStatus({ db }) as any[];
    const entry = statusAfterInstall.find((r) => r.server_id === SERVER_NAME && r.client_id === CLAUDE_CODE_CLIENT_ID);
    ok(entry, 'a lockfile entry should exist after install');
    strictEqual(entry.state, 'validated', 'install should advance state through to validated, not further');

    // --- Step 4: test (real MCP handshake against the fixture server) ---
    const testResult = await cmds.cmdTest(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, {
      db,
      mcpSpawnFn: fixtureMcpSpawn('v1'),
    });
    ok(testResult.ok, `test should succeed, got: ${JSON.stringify(!testResult.ok && testResult.error)}`);
    if (testResult.ok) {
      strictEqual(testResult.tools.length, 2, 'test should report the real tool count from the handshake');
    }

    // --- Step 5: activate (real config file write + real ownership tracking) ---
    const activateResult = cmds.cmdActivate(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, { db, projectRoot });
    ok(activateResult.ok);

    const configPath = claudeCodeConfigPath(projectRoot);
    ok(existsSync(configPath), 'activation should write a real .mcp.json file');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    ok(config.mcpServers[SERVER_NAME], 'the config should reference the activated server');
    strictEqual(config.mcpServers[SERVER_NAME].command, 'scopewatch-run');

    const statusAfterActivate = cmds.cmdStatus({ db }) as any[];
    const activeEntry = statusAfterActivate.find((r) => r.server_id === SERVER_NAME && r.client_id === CLAUDE_CODE_CLIENT_ID);
    strictEqual(activeEntry.state, 'active', 'activation should advance state to active');

    // --- Step 6: "weeks later" - update --check finds a new version ---
    const updateCheckResult = await cmds.cmdUpdateCheck(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, {
      db,
      fetchFn: makeFakeFetch('2.0.0'),
    });
    ok(updateCheckResult.ok);
    if (updateCheckResult.ok) {
      strictEqual(updateCheckResult.hasUpdate, true, 'update --check should detect the new version');
      strictEqual(updateCheckResult.currentVersion, '1.0.0');
      strictEqual(updateCheckResult.latestVersion, '2.0.0');
    }

    // --- Step 7: update (computes a REAL diff via the diff engine, between the
    // real v1 inferred manifest and a real v2 inferred manifest with a
    // genuinely new destructive tool) ---
    const updateResult = await cmds.cmdUpdate(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, {
      db,
      fetchFn: makeFakeFetch('2.0.0'),
      mcpSpawnFn: fixtureMcpSpawn('v2'),
    });
    ok(updateResult.ok, `update should succeed, got: ${JSON.stringify(!updateResult.ok && updateResult)}`);
    if (updateResult.ok) {
      strictEqual(updateResult.diff.newly_destructive, true, 'the real diff must catch the new destructive delete_record tool as Tier 1');
      strictEqual(updateResult.diff.riskLevel, 'high');
      ok(
        updateResult.rendered.toLowerCase().includes('delete_record'),
        `Expected the rendered diff to mention the new tool. Got: ${updateResult.rendered}`
      );

      // State must be 'updated', NOT 'active' - the diff has been shown but not approved
      const statusAfterUpdate = cmds.cmdStatus({ db }) as any[];
      const updatedEntry = statusAfterUpdate.find((r) => r.server_id === SERVER_NAME && r.client_id === CLAUDE_CODE_CLIENT_ID);
      strictEqual(updatedEntry.state, 'updated', 'update must show the diff and STOP at updated - never auto-activate');

      // --- Step 8: diff (retrieve and re-render the stored diff) ---
      const diffResult = cmds.cmdDiff(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, { db });
      ok(diffResult.ok);
      if (diffResult.ok) {
        ok(diffResult.rendered.toLowerCase().includes('delete_record'));
      }

      // --- Step 9: approve ---
      cmds.cmdApproveUpdate(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, updateResult.newManifestId, { db });
      const statusAfterApprove = cmds.cmdStatus({ db }) as any[];
      const finalEntry = statusAfterApprove.find((r) => r.server_id === SERVER_NAME && r.client_id === CLAUDE_CODE_CLIENT_ID);
      strictEqual(finalEntry.state, 'active', 'approving the update should move state back to active');
    }
  } finally {
    deleteSecret(secretReference);
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
