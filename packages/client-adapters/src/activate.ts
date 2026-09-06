import type { SqliteDatabase } from '@scopewatch/state';
import { recordOwnership, getOwnedKeys, removeOwnership } from '@scopewatch/state';
import { mergeConfig, readConfigFile, writeConfigFile } from './config-writer.js';
import type { ServerConfigEntry } from './config-writer.js';
import { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from './claude-code-adapter.js';
import { CURSOR_CLIENT_ID, cursorConfigPath } from './cursor-adapter.js';

export function configPathFor(client_id: string, projectRoot: string): string {
  if (client_id === CLAUDE_CODE_CLIENT_ID) return claudeCodeConfigPath(projectRoot);
  if (client_id === CURSOR_CLIENT_ID) return cursorConfigPath(projectRoot);
  throw new Error(`Unknown client_id: ${client_id}`);
}

/**
 * Write (or update) this server's entry in the given client's project-scope
 * config file. The generated entry's command points at the scopewatch-run
 * wrapper, never the real MCP server binary directly - this is what lets a
 * keychain-backed secret reach a process the CLIENT spawns (not Scopewatch
 * itself) without ever writing the secret's value into the config file or
 * requiring the user to export it into their shell environment. See
 * CLAUDE.md Phase F for the full reasoning.
 *
 * Uses the ownership-tracking table so this write can never clobber a key
 * Scopewatch doesn't own - any other server entry, or any other top-level
 * key, in the same file is left completely untouched.
 */
export function activateForClient(db: SqliteDatabase, server_id: string, client_id: string, projectRoot: string): void {
  const configPath = configPathFor(client_id, projectRoot);

  recordOwnership(db, server_id, client_id, configPath, server_id);
  const ownedKeys = getOwnedKeys(db, client_id, configPath);

  const entry: ServerConfigEntry = {
    command: 'scopewatch-run',
    args: [server_id, client_id],
  };

  const existing = readConfigFile(configPath);
  const updated = mergeConfig(existing, ownedKeys, { [server_id]: entry });
  writeConfigFile(configPath, updated);
}

/** Remove this server's entry from the given client's config file (deactivation). */
export function deactivateForClient(db: SqliteDatabase, server_id: string, client_id: string, projectRoot: string): void {
  const configPath = configPathFor(client_id, projectRoot);
  const ownedKeys = getOwnedKeys(db, client_id, configPath);

  const existing = readConfigFile(configPath);
  if (existing !== null && ownedKeys.has(server_id)) {
    const updated = mergeConfig(existing, ownedKeys, { [server_id]: null });
    writeConfigFile(configPath, updated);
  }

  removeOwnership(db, server_id, client_id);
}
