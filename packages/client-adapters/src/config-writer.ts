import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type ServerConfigEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/**
 * Ownership-tracked config merge: touches ONLY the keys in `ownedKeys`, never
 * anything else in the file - not other mcpServers entries, not other
 * top-level keys. This is Phase F's guarantee. It does NOT detect drift
 * within a key Scopewatch itself owns (e.g. a human hand-editing the args of
 * an entry Scopewatch created) - that's the client drift reconciler's job
 * (Phase H), not this function's.
 *
 * `updates` maps a config key to either a new entry (create/update) or null
 * (remove, e.g. on deactivation). Every key in `updates` MUST be present in
 * `ownedKeys` - this function refuses (throws) rather than silently writing
 * an unowned key, as a defense-in-depth check against caller bugs.
 */
export function mergeConfig(
  existingFileContent: string | null,
  ownedKeys: ReadonlySet<string>,
  updates: Record<string, ServerConfigEntry | null>
): string {
  for (const key of Object.keys(updates)) {
    if (!ownedKeys.has(key)) {
      throw new Error(
        `Refusing to write config key "${key}": not in Scopewatch's ownership set for this file. ` +
          `This should never happen from normal activation - it indicates a caller bug.`
      );
    }
  }

  const existing: Record<string, unknown> = existingFileContent ? JSON.parse(existingFileContent) : {};
  const mcpServers: Record<string, unknown> = { ...(existing.mcpServers as Record<string, unknown> | undefined) };

  for (const [key, entry] of Object.entries(updates)) {
    if (entry === null) {
      delete mcpServers[key];
    } else {
      mcpServers[key] = entry;
    }
  }

  return JSON.stringify({ ...existing, mcpServers }, null, 2) + '\n';
}

/** Read a config file's raw content, or null if it doesn't exist yet. */
export function readConfigFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

/** Write a config file, creating its parent directory if needed (e.g. Cursor's .cursor/ subdir). */
export function writeConfigFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
