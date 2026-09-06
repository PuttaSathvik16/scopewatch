import { join } from 'node:path';

export const CLAUDE_CODE_CLIENT_ID = 'claude-code';

/**
 * Project-scope config path only (see CLAUDE.md Phase F: v1 does not support
 * user/global-scope activation - that would mean writing to ~/.claude.json,
 * a large multi-project, multi-purpose file. This is a stated MVP limitation:
 * a server must be activated per-project in v1, not once for every project
 * on the machine.)
 */
export function claudeCodeConfigPath(projectRoot: string): string {
  return join(projectRoot, '.mcp.json');
}
