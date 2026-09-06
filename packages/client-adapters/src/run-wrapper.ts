import { spawn, type ChildProcess } from 'node:child_process';
import { LifecycleEngine, getCurrentManifestFor, type SqliteDatabase } from '@scopewatch/state';
import { injectSecrets, secretRef } from '@scopewatch/secrets';

export type SpawnFn = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, { env: options.env, stdio: 'inherit' });

export type RunWrapperDeps = {
  db: SqliteDatabase;
  spawn?: SpawnFn;
  stderr?: (line: string) => void;
  process?: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    kill: (pid: number, signal: NodeJS.Signals) => void;
    exit: (code: number) => void;
    pid: number;
    removeAllListeners: (event: string) => void;
  };
};

/**
 * The scopewatch-run wrapper's core logic, factored out from the thin bin
 * entry point so it's fully testable without spawning a real subprocess for
 * every test.
 *
 * Three safety properties, each required before this exists at all:
 *
 * 1. STATE GATE: refuses to launch unless the (server_id, client_id) pair's
 *    lifecycle state is exactly 'active'. This wrapper runs OUTSIDE the CLI -
 *    the client (Claude Code/Cursor) invokes it directly, often on its own
 *    restart. Without this gate, a client restart while an update sits
 *    unapproved (state 'updated', diff shown but not yet confirmed) would
 *    silently activate it the moment the client happens to respawn the
 *    process - violating "every diff shown before activation, never after."
 *    This wrapper never decides what "current" means; it only defers to
 *    whatever the lifecycle engine has already recorded as approved.
 *
 * 2. FAIL LOUD on secret retrieval failure: never execs the real server
 *    without its required secrets. A server silently launched with missing
 *    credentials fails downstream in a confusing, vendor-specific way with
 *    no link back to Scopewatch - exactly what the diagnostics module exists
 *    to prevent, so this wrapper does not create that failure mode itself.
 *
 * 3. Process relationship: spawn with stdio: 'inherit' (not manual piping) -
 *    the real server shares this process's stdin/stdout/stderr file
 *    descriptors directly, so MCP's JSON-RPC stdio protocol traffic is never
 *    touched or buffered by an extra hop. Signals sent to the wrapper are
 *    forwarded to the child; the wrapper exits with the child's exact exit
 *    code (or re-raises the same signal if the child was signal-killed), so
 *    the client's own process monitoring sees accurate status.
 */
export async function runWrapper(server_id: string, client_id: string, deps: RunWrapperDeps): Promise<number> {
  const { db } = deps;
  const spawnFn = deps.spawn ?? defaultSpawn;
  const stderr = deps.stderr ?? ((line: string) => process.stderr.write(line + '\n'));
  const proc = deps.process ?? process;

  // --- 1. State gate ---
  const engine = new LifecycleEngine(db);
  const state = engine.getState(server_id, client_id);
  if (state !== 'active') {
    stderr(
      `scopewatch-run: refusing to launch '${server_id}' for '${client_id}': lifecycle state is ` +
        `'${state ?? 'unknown (not installed)'}', not 'active'. An update may be pending review - ` +
        `run 'scopewatch diff ${server_id}' or 'scopewatch update ${server_id}' to review and approve it first.`
    );
    return 1;
  }

  // --- Look up the manifest to know what to actually launch and what secrets it needs ---
  const manifest = getCurrentManifestFor(db, server_id, client_id);
  if (!manifest) {
    stderr(`scopewatch-run: no manifest on record for '${server_id}' on '${client_id}'. Cannot launch.`);
    return 1;
  }

  const manifestData = JSON.parse(manifest.manifest_json) as {
    source: { type: string; location: string };
    secrets: { id: string }[];
  };

  // --- 2. Fail loud on secret retrieval failure ---
  const secretRefs = manifestData.secrets.map((s) => ({ envVar: s.id, ref: secretRef(server_id, s.id) }));
  const injectResult = injectSecrets(secretRefs);
  if (!injectResult.ok) {
    stderr(
      `scopewatch-run: failed to retrieve required secrets for '${server_id}': ${injectResult.error.message}. ` +
        `Refusing to launch the server without its credentials.`
    );
    return 1;
  }

  // --- 3. Spawn with inherited stdio, forward signals, propagate exit status ---
  return new Promise<number>((resolve) => {
    const child = spawnFn('npx', ['-y', manifestData.source.location], {
      env: { ...global.process.env, ...injectResult.env },
    });

    const signalsToForward: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    for (const sig of signalsToForward) {
      proc.on(sig, () => {
        if (child.pid) child.kill(sig);
      });
    }

    child.on('exit', (code, signal) => {
      if (signal) {
        // Re-raise the same signal on ourselves so the parent sees accurate
        // signal-based termination status, matching standard process-wrapper
        // behavior (e.g. tini, dumb-init).
        proc.removeAllListeners(signal);
        proc.kill(proc.pid, signal);
        resolve(128); // fallback if the re-raised signal doesn't terminate synchronously in a test harness
      } else {
        resolve(code ?? 1);
      }
    });

    child.on('error', (err) => {
      stderr(`scopewatch-run: failed to start '${server_id}': ${err.message}`);
      resolve(1);
    });
  });
}
