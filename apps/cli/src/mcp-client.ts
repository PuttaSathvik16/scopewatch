import { spawn, type ChildProcess } from 'node:child_process';
import {
  spawnFailedError,
  handshakeTimeoutError,
  malformedResponseError,
  protocolErrorResponse,
  type McpTestError,
} from './mcp-errors.js';

export type SpawnFn = (command: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, env) => spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

export type McpToolResult = {
  name: string;
  description: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }> };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

/**
 * Baseline connection/tool-list check: spawn the server, perform the real
 * MCP JSON-RPC initialize handshake, then call tools/list. This is
 * DELIBERATELY minimal - it answers "does this process speak MCP at all,"
 * nothing more. Sanitized log capture, retry/backoff, and deeper failure
 * taxonomies are the Phase I diagnostics module's job, not this function's.
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
    let settled = false;
    let sentInitialized = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, error: handshakeTimeoutError(timeoutMs) });
    }, timeoutMs);

    const finish = (result: { ok: true; tools: McpToolResult[] } | { ok: false; error: McpTestError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    child.on('error', (err) => {
      finish({ ok: false, error: spawnFailedError(command, err.message) });
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
          finish({ ok: false, error: protocolErrorResponse(msg.error.code ?? -1, msg.error.message ?? 'unknown error') });
          return;
        }

        if (msg.id === 1 && msg.result) {
          // initialize succeeded - send initialized notification, then tools/list
          if (!sentInitialized) {
            sentInitialized = true;
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          }
        } else if (msg.id === 2 && msg.result) {
          finish({ ok: true, tools: msg.result.tools ?? [] });
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
