import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@scopewatch/state';
import { CLAUDE_CODE_CLIENT_ID } from '@scopewatch/client-adapters';
import * as cmds from '../src/commands.js';
import type { RegistryServer, FetchFn } from '../src/registry-client.js';
import type { SpawnFn as McpSpawnFn } from '../src/mcp-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SERVER = join(__dirname, 'fixtures', 'fake-real-mcp-server.mjs');
const SERVER_NAME = 'io.github.test/cmd-install-duplicate-fixture';

function fakeRegistryServer(): RegistryServer {
  return {
    name: SERVER_NAME,
    description: 'A fixture server for duplicate-install testing.',
    version: '1.0.0',
    packages: [
      {
        registryType: 'npm',
        identifier: 'cmd-install-duplicate-fixture-package',
        version: '1.0.0',
        transport: { type: 'stdio' },
        environmentVariables: [],
      },
    ],
    repository: { url: 'https://github.com/test/cmd-install-duplicate-fixture', source: 'github' },
  };
}

const fakeFetch: FetchFn = (async (url: string | URL) => {
  if (url.toString().includes('/versions/')) {
    return new Response(JSON.stringify({ server: fakeRegistryServer() }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}) as FetchFn;

const fixtureMcpSpawn: McpSpawnFn = (_command, _args, env) =>
  spawn('node', [FIXTURE_SERVER], { env: { ...env, SCOPEWATCH_FIXTURE_VERSION: 'v1' }, stdio: ['pipe', 'pipe', 'pipe'] });

const fakePrereqRunner = (command: string) => (command === 'node' ? 'v22.5.0\n' : '10.8.2\n');
const fakeInstallRunner = () => ({ code: 0, stdout: 'added 1 package', stderr: '' });

test('cmdInstall: re-installing the same server+version returns a clear, actionable error - not a raw SQLite constraint failure', async () => {
  // Found via a real user report: running `scopewatch install <server>`
  // twice for the same server+version hit insertManifest's raw
  // UNIQUE(server_id, version) constraint, surfacing as an uncategorized
  // "Unexpected error: UNIQUE constraint failed: manifests.server_id,
  // manifests.version" - exactly the kind of unactionable error this
  // project's own stated design (README: "Fails loud, with a recovery
  // path... never a raw stack trace") rules out. The fix checks
  // getManifestByVersion() up front and fails fast with guidance instead.
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmd-install-dup-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);

  try {
    const deps = {
      db,
      fetchFn: fakeFetch,
      prereqRunner: fakePrereqRunner,
      installRunner: fakeInstallRunner,
      mcpSpawnFn: fixtureMcpSpawn,
      promptFn: async () => '',
    };

    const first = await cmds.cmdInstall(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, deps);
    ok(first.ok, `first install should succeed, got: ${JSON.stringify(!first.ok && first)}`);

    const second = await cmds.cmdInstall(SERVER_NAME, CLAUDE_CODE_CLIENT_ID, deps);
    ok(!second.ok, 'a second install of the same server+version must fail, not silently no-op');
    if (!second.ok) {
      strictEqual(second.stage, 'already_installed');
      ok(
        second.error instanceof Error && /already installed/.test(second.error.message),
        `error must be a clear, actionable message, not a raw constraint failure - got: ${second.error}`
      );
      ok(
        !(second.error instanceof Error && /UNIQUE constraint/.test(second.error.message)),
        'must never leak the raw SQLite constraint message to the user'
      );
    }
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
