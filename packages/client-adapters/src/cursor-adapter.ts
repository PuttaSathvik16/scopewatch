import { join } from 'node:path';

export const CURSOR_CLIENT_ID = 'cursor';

/**
 * Project-scope config path only (see CLAUDE.md Phase F: v1 does not support
 * global-scope activation - that would mean writing to ~/.cursor/mcp.json,
 * shared across every project on the machine. Stated MVP limitation, same as
 * Claude Code's project-scope-only restriction.)
 */
export function cursorConfigPath(projectRoot: string): string {
  return join(projectRoot, '.cursor', 'mcp.json');
}
