import { spawn, type ChildProcess } from 'node:child_process';
import { redact } from '@scopewatch/secrets';
import {
  spawnFailedError,
  handshakeTimeoutError,
  malformedResponseError,
  initializeRejectedError,
  toolsListFailedError,
  protocolErrorResponse,
  attachStderrContext,
  type McpTestError,
} from './mcp-errors.js';

export type SpawnFn = (command: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;

// command is frequently 'npx', which ships as a .cmd file on Windows - Node's
// automatic bare-command PATH resolution only finds real executables
// (.exe/.com) without shell: true, so this would ENOENT on every real
// Windows machine otherwise. See apps/cli/src/real-runners.ts for the full
// account of how this class of bug was found and why shell: true is safe on
// this project's Node floor (22.0.0, well past CVE-2024-27980).
const defaultSpawn: SpawnFn = (command, args, env) =>
  spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });

export type McpToolResult = {
  name: string;
  description: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }> };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

function isValidToolsListResult(result: unknown): result is { tools: McpToolResult[] } {
  if (typeof result !== 'object' || result === null) return false;
  const tools = (result as any).tools;
  if (!Array.isArray(tools)) return false;
  return tools.every((t) => typeof t === 'object' && t !== null && typeof t.name === 'string' && typeof t.description === 'string');
}

/**
 * Baseline connection/tool-list check: spawn the server, perform the real
 * MCP JSON-RPC initialize handshake, then call tools/list. Deliberately
 * minimal beyond the categorized failures below - it answers "does this
 * process speak MCP at all, and can it enumerate its tools," nothing more.
 * Retry/backoff is explicitly out of scope for v1: this function reports
 * current, actual status at the moment it's run - a retry loop would blur
 * "is this broken right now" into "was this eventually reachable," a
 * weaker signal for a trust/diagnostic tool. A flaky real server's slow
 * cold start is itself diagnostically meaningful, surfaced as a timeout,
 * not silently retried away.
 *
 * SANITIZED LOG CAPTURE: stderr from the real spawned process is captured
 * and passed through @scopewatch/secrets' redact() (Phase D) - the SAME
 * mechanism used everywhere else in this build, not a second one - before
 * being attached to any returned error. This matters because a failing
 * server's raw stderr is exactly the kind of place a secret value could
 * leak unexpectedly (embedded in an error message, not just in an expected
 * field) - the same risk that justified content-based redaction in Phase D.
 * Any secret this handshake's env actually contains was already registered
 * for redaction by retrieveSecret() at the point it was fetched (Phase D),
 * so redact() here catches it automatically.
 */
export function mcpHandshakeAndListTools(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  spawnFn: SpawnFn = defaultSpawn,
  timeoutMs = 10000
): Promise<{ ok: true; tools: McpToolResult[] } | { ok: false; error: McpTestError }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(command, args, env);
    } catch (err: any) {
      resolve({ ok: false, error: spawnFailedError(command, String(err?.message ?? err)) });
      return;
    }

    let buffer = '';
    let stderrBuffer = '';
    let settled = false;
    let sentInitialized = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, error: withStderr(handshakeTimeoutError(timeoutMs)) });
    }, timeoutMs);

    const withStderr = (error: McpTestError): McpTestError => attachStderrContext(error, redact(stderrBuffer));

    const finish = (result: { ok: true; tools: McpToolResult[] } | { ok: false; error: McpTestError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (!result.ok) result.error = withStderr(result.error);
      resolve(result);
    };

    child.on('error', (err) => {
      finish({ ok: false, error: spawnFailedError(command, err.message) });
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          finish({ ok: false, error: malformedResponseError(line) });
          return;
        }

        if (msg.error) {
          // Distinguish which stage rejected us: id 1 is initialize, id 2 is tools/list.
          if (msg.id === 1) {
            finish({ ok: false, error: initializeRejectedError(msg.error.code ?? -1, msg.error.message ?? 'unknown error') });
          } else if (msg.id === 2) {
            finish({ ok: false, error: toolsListFailedError(msg.error.code ?? -1, msg.error.message ?? 'unknown error') });
          } else {
            finish({ ok: false, error: protocolErrorResponse(msg.error.code ?? -1, msg.error.message ?? 'unknown error') });
          }
          return;
        }

        if (msg.id === 1 && msg.result) {
          // initialize succeeded - send initialized notification, then tools/list
          if (!sentInitialized) {
            sentInitialized = true;
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          }
        } else if (msg.id === 2 && msg.result !== undefined) {
          if (!isValidToolsListResult(msg.result)) {
            finish({ ok: false, error: malformedResponseError(line) });
            return;
          }
          finish({ ok: true, tools: msg.result.tools });
          return;
        }
      }
    });

    child.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'scopewatch', version: '0.0.1' },
        },
      }) + '\n'
    );
  });
}
