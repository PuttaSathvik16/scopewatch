import { join } from 'node:path';

export const VSCODE_CLIENT_ID = 'vscode';

/**
 * Project-scope config path only, same restriction as Claude Code and
 * Cursor (see claude-code-adapter.ts) - v1 does not support VS Code's
 * user-profile-scope mcp.json, only the workspace file.
 *
 * Verified against real VS Code docs (code.visualstudio.com/docs/copilot/
 * chat/mcp-servers) before implementing: the workspace file's top-level key
 * is "servers", NOT "mcpServers" like Claude Code/Cursor - a genuine format
 * difference, not an oversight. See configKeyFor() in activate.ts for where
 * that's threaded through.
 */
export function vscodeConfigPath(projectRoot: string): string {
  return join(projectRoot, '.vscode', 'mcp.json');
}
