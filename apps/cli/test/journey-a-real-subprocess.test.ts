import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteSecret, secretRef } from '@scopewatch/secrets';

/**
 * The single strongest piece of evidence this build can produce: the ACTUAL
 * COMPILED BINARY (apps/cli/dist/main.js), invoked as a REAL child process
 * with real argv and real stdio - not cmdX() functions called directly,
 * which is exactly the blind spot that let update/diff/approve ship with
 * zero real CLI entry point undetected through every prior "end-to-end"
 * test. Runs a meaningful slice of Journey A through commander.js's real
 * argument parsing, real process boundaries, and real exit codes.
 *
 * Isolation, so this never touches the real user's environment:
 * - SCOPEWATCH_STATE_DIR points at a disposable temp dir, never ~/.scopewatch.
 * - SCOPEWATCH_REGISTRY_URL points at a real local HTTP server serving
 *   fixture data, never the real registry.
 * - A shim bin directory is prepended to PATH so this process's real `npm`
 *   and `npx` invocations (unavoidable side effects of the REAL
 *   installPackage/mcpHandshakeAndListTools code paths, which this test
 *   deliberately does NOT bypass via code injection) resolve to disposable
 *   fixture scripts instead of touching the real npm registry. `node`
 *   itself is shimmed too, ONLY for --version, so checkPrerequisites'
 *   real logic genuinely runs against a real (if faked) version string -
 *   necessary because this dev machine's own real Node (21.7.1) is below
 *   Scopewatch's own 22.0.0 floor, the same honest fact disclosed in every
 *   earlier phase. This does not disable the check; it controls what the
 *   check observes, exactly the same DI principle used throughout this
 *   codebase, just at the OS-process boundary since a real subprocess
 *   can't be code-injected.
 * - Secrets still land in the REAL macOS keychain (as every real run
 *   would) - cleaned up in a finally block, matching established practice.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'dist', 'main.js');
const FIXTURE_MCP_SERVER = join(__dirname, 'fixtures', 'fake-real-mcp-server.mjs');

const SERVER_NAME = 'io.github.test/real-subprocess-server';
const SECRET_VALUE = 'real-subprocess-fixture-secret-value';

function fakeRegistryServer(version: string) {
  return {
    name: SERVER_NAME,
    description: 'A fixture server for the real-subprocess Journey A test.',
    version,
    packages: [
      {
        registryType: 'npm',
        identifier: 'real-subprocess-fixture-package',
        version,
        transport: { type: 'stdio' },
        environmentVariables: [{ name: 'REAL_SUBPROCESS_TOKEN', description: 'Fixture token', isRequired: true }],
      },
    ],
    repository: { url: 'https://github.com/test/real-subprocess-server', source: 'github' },
  };
}

function startMockRegistry(version: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (url.includes('/versions/')) {
        res.end(JSON.stringify({ server: fakeRegistryServer(version) }));
      } else if (url.includes('?search=')) {
        res.end(JSON.stringify({ servers: [{ server: fakeRegistryServer(version) }], metadata: { count: 1 } }));
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function makeShimBin(): string {
  const shimDir = mkdtempSync(join(tmpdir(), 'scopewatch-shim-bin-'));
  const realNode = process.execPath;

  // node shim: fakes --version only (this machine's real Node is below
  // Scopewatch's own floor); forwards everything else to the REAL node,
  // since npx/npm scripts and the CLI binary itself genuinely need it.
  writeFileSync(
    join(shimDir, 'node'),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "v22.5.0"; else exec "${realNode}" "$@"; fi\n`
  );
  chmodSync(join(shimDir, 'node'), 0o755);

  // npm shim: fakes --version, and fakes `install <pkg> --prefix <dir>` by
  // creating a minimal real package structure instead of hitting the real registry.
  writeFileSync(
    join(shimDir, 'npm'),
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.8.2"
  exit 0
fi
if [ "$1" = "install" ]; then
  PREFIX=""
  PKG=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--prefix" ]; then PREFIX="$arg"; fi
    prev="$arg"
  done
  PKG="$2"
  mkdir -p "$PREFIX/node_modules/$PKG"
  echo '{"name":"'"$PKG"'","version":"1.0.0","main":"index.js"}' > "$PREFIX/node_modules/$PKG/package.json"
  echo 'export {};' > "$PREFIX/node_modules/$PKG/index.js"
  echo "added 1 package"
  exit 0
fi
exit 1
`
  );
  chmodSync(join(shimDir, 'npm'), 0o755);

  // npx shim: ignores the requested package identifier entirely and execs
  // the real, protocol-real fixture MCP server script instead - this is
  // the ONLY place the "real server" is substituted, and it happens at the
  // OS command-resolution level, not inside any of Scopewatch's own code.
  writeFileSync(
    join(shimDir, 'npx'),
    `#!/bin/sh\nexec "${realNode}" "${FIXTURE_MCP_SERVER}"\n`
  );
  chmodSync(join(shimDir, 'npx'), 0o755);

  return shimDir;
}

// Deliberately async (execFile, not execFileSync): the mock HTTP registry
// server in this test lives IN this same process, not a separate one. A
// synchronous exec would freeze this process's event loop while waiting for
// the child - including the event loop the mock server itself needs to ever
// answer the child's request - deadlocking every network-touching command
// until the child's own timeout fires. Found by exactly that symptom: doctor
// (no network) passed, search (first real fetch()) hung for precisely the
// configured timeout with no real error.
async function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const child = execFileAsync(process.execPath, [CLI_BIN, ...args], {
      env,
      encoding: 'utf-8',
      timeout: 15000,
    });
    child.child.stdin?.end(input ?? '');
    const { stdout } = await child;
    return { stdout, stderr: '', code: 0 };
  } catch (err: any) {
    const rawStderr = err.stderr?.toString() ?? '';
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: rawStderr.length > 0 ? rawStderr : `[signal=${err.signal} status=${err.status} message=${err.message}]`,
      code: typeof err.code === 'number' ? err.code : typeof err.status === 'number' ? err.status : 1,
    };
  }
}

/**
 * `promptSecret()` (Phase D) deliberately refuses to read from a non-TTY
 * stdin - a real security guardrail, not a bug, so a plain piped
 * execFile/execFileSync cannot exercise `install`'s real secret prompt at
 * all. Rather than weaken that guardrail with a test-only bypass flag (which
 * would reopen exactly the class of risk it exists to prevent, for any real
 * user who happened to set the same env var), this allocates a REAL
 * pseudo-terminal so the child genuinely sees `stdin.isTTY === true`, then
 * writes the secret into it - faithfully exercising the real interactive
 * path, not routing around it.
 *
 * Uses Python's stdlib `pty.spawn` (via `os.openpty()`), not macOS's `script`
 * utility: `script` needs to `tcgetattr` its OWN inherited stdin to save/
 * restore terminal modes, which fails with "Operation not supported on
 * socket" whenever it's given piped stdio (as `child_process.spawn` always
 * provides on macOS, where pipes are socketpairs) rather than a real
 * inherited terminal - true here regardless of node:test, reproduced
 * identically from a plain top-level script. `pty.spawn` instead opens a
 * fresh pty pair directly and is unaffected by what its own stdio is.
 *
 * Writes `input` THREE times, spaced out, not once: under a real controlling
 * terminal (which this pty genuinely is), macOS's `security` binary - shelled
 * out to by @scopewatch/secrets' storeSecret - bypasses whatever this test
 * pipes to Scopewatch's own process entirely and reads its OWN confirm+retype
 * password prompt directly from /dev/tty (a deliberate macOS behavior so
 * password entry can't be scripted around; see Phase D's notes on `-w` with
 * no value). Confirmed by manual reproduction: one write satisfies only the
 * CLI's own readline prompt and then hangs forever on security's separate
 * "password data for new item:" / "retype password for new item:" prompts;
 * three writes (same value each time) clears all of them.
 */
function runCliWithTty(args: string[], env: NodeJS.ProcessEnv, input: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const pySnippet = `import pty, sys; sys.exit(pty.spawn([${JSON.stringify(process.execPath)}, ${JSON.stringify(CLI_BIN)}${args.map((a) => `, ${JSON.stringify(a)}`).join('')}]) >> 8)`;
    const child = spawn('python3', ['-c', pySnippet], { env });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stdout += chunk.toString()));
    const timers = [300, 1500, 2700].map((ms) => setTimeout(() => child.stdin.write(input), ms));
    child.on('close', (code) => {
      timers.forEach(clearTimeout);
      resolve({ stdout, code: code ?? 1 });
    });
  });
}

test(
  'REAL SUBPROCESS Journey A: the actual compiled binary, run as a real user would, completes install through diff',
  { timeout: 60000 },
  async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'scopewatch-real-state-'));
  const shimDir = makeShimBin();
  const secretReference = secretRef(SERVER_NAME, 'REAL_SUBPROCESS_TOKEN');

  const { server: registryServer, url: registryUrl } = await startMockRegistry('1.0.0');
  // Tracks whichever mock registry server is currently live, so the finally
  // block below can always close it - a prior run leaked every one of these
  // on any failure before the mid-test registryServer.close() line, since
  // that line is only reached on the happy path. A leaked in-process HTTP
  // server keeps node:test's own process alive forever (never exits), which
  // is exactly what silently piled up six stale processes across six failed
  // runs earlier in this debugging session.
  let currentRegistryServer: Server = registryServer;

  const baseEnv: NodeJS.ProcessEnv = {
    PATH: `${shimDir}${delimiter}${process.env.PATH}`,
    SCOPEWATCH_STATE_DIR: stateDir,
    SCOPEWATCH_REGISTRY_URL: registryUrl,
    HOME: process.env.HOME,
  };

  try {
    // --- doctor: real subprocess, real (shimmed) node/npm version resolution ---
    const doctorResult = await runCli(['doctor'], baseEnv);
    strictEqual(doctorResult.code, 0, `doctor should succeed via the real binary. stderr: ${doctorResult.stderr}`);
    ok(doctorResult.stdout.includes('22.5.0'), `Expected the real (shimmed) version in doctor's real output. Got: "${doctorResult.stdout}"`);

    // --- search: real subprocess, real HTTP request to the local mock registry ---
    const searchResult = await runCli(['search', 'real-subprocess'], baseEnv);
    strictEqual(searchResult.code, 0, `search failed. stderr: ${searchResult.stderr}`);
    ok(searchResult.stdout.includes(SERVER_NAME), `Expected the real server name in search output. Got: "${searchResult.stdout}"`);

    // --- info: real subprocess ---
    const infoResult = await runCli(['info', SERVER_NAME], baseEnv);
    strictEqual(infoResult.code, 0, `info failed. stderr: ${infoResult.stderr}`);
    ok(infoResult.stdout.includes('1.0.0'), `Expected the real version in info output. Got: "${infoResult.stdout}"`);

    // --- install: real subprocess, real npm/npx (shimmed), real MCP handshake
    // against the real fixture server process, secret prompt answered through
    // a REAL pty (see runCliWithTty) since promptSecret() genuinely refuses
    // non-TTY stdin ---
    const installResult = await runCliWithTty(['install', SERVER_NAME], baseEnv, `${SECRET_VALUE}\n`);
    strictEqual(installResult.code, 0, `install failed via the real binary. stdout: ${installResult.stdout}`);
    ok(installResult.stdout.toLowerCase().includes('installed'), `Expected confirmation in real install output. Got: "${installResult.stdout}"`);

    // --- test: real subprocess, real handshake against the real fixture server ---
    const testResult = await runCli(['test', SERVER_NAME], baseEnv);
    strictEqual(testResult.code, 0, `test command failed via the real binary. stdout: ${testResult.stdout} stderr: ${testResult.stderr}`);
    ok(testResult.stdout.toLowerCase().includes('ok'), `Expected a success report from the real test command. Got: "${testResult.stdout}"`);

    // --- activate: real subprocess, real config file written to a real temp project dir ---
    // activateForClient uses process.cwd() when no --project-root is passed, so this
    // exercises the CLI's actual real cwd-based behavior by launching the subprocess
    // FROM that directory (the `cwd` spawn option - NOT the PWD env var, which does
    // not actually change a child process's working directory).
    const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-real-project-'));
    const activateResultInCwd = await (async () => {
      try {
        const { stdout } = await execFileAsync(process.execPath, [CLI_BIN, 'activate', SERVER_NAME], {
          env: baseEnv,
          cwd: projectRoot,
          encoding: 'utf-8',
          timeout: 15000,
        });
        return { stdout, code: 0 };
      } catch (err: any) {
        return { stdout: err.stdout?.toString() ?? '', code: typeof err.code === 'number' ? err.code : typeof err.status === 'number' ? err.status : 1, stderr: err.stderr?.toString() };
      }
    })();
    strictEqual(activateResultInCwd.code, 0, `activate failed via the real binary. Got: ${JSON.stringify(activateResultInCwd)}`);
    const configPath = join(projectRoot, '.mcp.json');
    ok(existsSync(configPath), 'activate should have written a REAL .mcp.json in the real cwd');

    // --- update --check: real subprocess, real HTTP request against the mock registry (now serving v2.0.0) ---
    registryServer.close();
    const { server: registryServerV2, url: registryUrlV2 } = await startMockRegistry('2.0.0');
    currentRegistryServer = registryServerV2;
    const envV2 = { ...baseEnv, SCOPEWATCH_REGISTRY_URL: registryUrlV2 };

    const updateCheckResult = await runCli(['update', SERVER_NAME, '--check'], envV2);
    strictEqual(updateCheckResult.code, 0, `update --check failed. stderr: ${updateCheckResult.stderr}`);
    ok(updateCheckResult.stdout.includes('2.0.0'), `Expected the new version mentioned. Got: "${updateCheckResult.stdout}"`);

    // --- update: real subprocess, real diff computed and shown, real interactive
    // approval prompt answered via real stdin ---
    const updateResult = await runCli(['update', SERVER_NAME], envV2, 'y\n');
    strictEqual(updateResult.code, 0, `update failed via the real binary. stdout: ${updateResult.stdout} stderr: ${updateResult.stderr}`);
    ok(updateResult.stdout.includes('Approved'), `Expected approval confirmation. Got: "${updateResult.stdout}"`);

    // --- diff: real subprocess, re-shows the real stored diff ---
    const diffResult = await runCli(['diff', SERVER_NAME], envV2);
    strictEqual(diffResult.code, 0, `diff failed via the real binary. stderr: ${diffResult.stderr}`);
    ok(diffResult.stdout.length > 0, 'diff should produce real rendered output');

  } finally {
    currentRegistryServer.close();
    deleteSecret(secretReference);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
  }
);
