import {
  LifecycleEngine,
  updateOwnershipSnapshot,
  removeOwnership,
  type SqliteDatabase,
} from '@scopewatch/state';
import { readConfigFile, writeConfigFile, mergeConfig, type ServerConfigEntry } from './config-writer.js';
import { configKeyFor } from './activate.js';
import { getOwnedKeys } from '@scopewatch/state';
import type { DriftEntry, DriftStatus } from './drift.js';

export type DriftResolution = 'keep' | 'restore' | 'skip';

/**
 * Valid resolutions per status - 'restore' is never offered for
 * 'unverifiable' (no real prior value exists to restore to; see CLAUDE.md
 * Phase H for the data-loss hazard this specifically prevents).
 */
export function validResolutionsFor(status: DriftStatus): DriftResolution[] {
  if (status === 'unchanged') return ['skip'];
  if (status === 'unverifiable') return ['keep', 'skip'];
  return ['keep', 'restore', 'skip'];
}

export type ResolveResult = { ok: true } | { ok: false; error: Error };

/**
 * Applies one resolution to one drifted entry. Restoration reuses the EXACT
 * SAME mergeConfig/writeConfigFile pipeline activateForClient uses - not a
 * second parallel implementation of "write this key without touching
 * others."
 */
export function resolveDriftEntry(db: SqliteDatabase, entry: DriftEntry, resolution: DriftResolution): ResolveResult {
  const validResolutions = validResolutionsFor(entry.status);
  if (!validResolutions.includes(resolution)) {
    return {
      ok: false,
      error: new Error(
        `'${resolution}' is not a valid resolution for status '${entry.status}' ` +
          `(valid: ${validResolutions.join(', ')}). ${
            entry.status === 'unverifiable' && resolution === 'restore'
              ? 'No real prior snapshot exists for this entry - there is nothing to restore to.'
              : ''
          }`
      ),
    };
  }

  if (resolution === 'skip') return { ok: true };

  if (entry.status === 'changed' && resolution === 'keep') {
    updateOwnershipSnapshot(db, entry.server_id, entry.client_id, JSON.stringify(entry.liveValue));
    return { ok: true };
  }

  if (entry.status === 'changed' && resolution === 'restore') {
    return restoreEntry(db, entry);
  }

  if (entry.status === 'missing' && resolution === 'restore') {
    return restoreEntry(db, entry);
  }

  if (entry.status === 'missing' && resolution === 'keep') {
    return disablePair(db, entry);
  }

  if (entry.status === 'unverifiable' && resolution === 'keep') {
    if (entry.liveValue === undefined) {
      // No snapshot AND no live entry either - there is nothing real here at all.
      return disablePair(db, entry);
    }
    updateOwnershipSnapshot(db, entry.server_id, entry.client_id, JSON.stringify(entry.liveValue));
    return { ok: true };
  }

  return { ok: false, error: new Error(`Unhandled resolution combination: status=${entry.status}, resolution=${resolution}`) };
}

function restoreEntry(db: SqliteDatabase, entry: DriftEntry): ResolveResult {
  const ownedKeys = getOwnedKeys(db, entry.client_id, entry.config_file_path);
  const existing = readConfigFile(entry.config_file_path);
  const updated = mergeConfig(
    existing,
    ownedKeys,
    { [entry.config_key]: entry.storedSnapshot as ServerConfigEntry },
    configKeyFor(entry.client_id)
  );
  writeConfigFile(entry.config_file_path, updated);
  return { ok: true };
}

/**
 * "Keep the removal": the config entry is genuinely gone, so this
 * (server_id, client_id) pair is no longer actually wired into the client.
 * lockfile_entries.state MUST reflect that - going through the real
 * lifecycle engine intent/confirm mechanism, not a raw UPDATE - otherwise
 * `status` would report 'active' for a server that isn't actually
 * activated anywhere anymore.
 */
function disablePair(db: SqliteDatabase, entry: DriftEntry): ResolveResult {
  try {
    const engine = new LifecycleEngine(db);
    const intentId = engine.startTransition(entry.server_id, entry.client_id, 'active', 'disabled', null);
    engine.confirmTransition(intentId);
    removeOwnership(db, entry.server_id, entry.client_id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
