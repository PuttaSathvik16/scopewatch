import { readConfigFile } from './config-writer.js';
import { malformedConfigStructureError } from './drift-errors.js';
import type { DriftError } from './drift-errors.js';
import { getAllOwnershipRows, getOwnershipRow, type SqliteDatabase, type OwnershipRow } from '@scopewatch/state';

/**
 * Four statuses, not three - see CLAUDE.md Phase H for why 'unverifiable'
 * exists: a pre-migration ownership row has no real historical snapshot
 * (last_written_value is NULL), and treating that as 'changed' would let a
 * user "restore" a fabricated value over their real, working config entry.
 * 'unverifiable' rows can only ever be resolved by adopting the current
 * live value as the new baseline - never restored FROM, since there is
 * nothing real to restore.
 */
export type DriftStatus = 'unchanged' | 'changed' | 'missing' | 'unverifiable';

export type DriftEntry = {
  server_id: string;
  client_id: string;
  config_key: string;
  config_file_path: string;
  status: DriftStatus;
  storedSnapshot: unknown; // parsed last_written_value, or undefined if none exists (unverifiable)
  liveValue: unknown | undefined; // parsed current value, or undefined if the key is missing
};

export type DriftCheckResult = { ok: true; entry: DriftEntry } | { ok: false; error: DriftError };

/** Round-trip JSON normalization tolerates harmless whitespace/key-order
 * differences from re-serialization that are not real drift. */
function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Validates the file's top-level shape BEFORE attempting any per-key
 * comparison. A file that doesn't parse, or whose mcpServers isn't an
 * object, is a distinct, more severe situation than ordinary drift - it
 * means something rewrote the file's overall structure, not just this one
 * entry - and must surface as an explicit error, never be forced into the
 * unchanged/changed/missing/unverifiable model.
 */
function validateConfigStructure(
  configPath: string,
  raw: string | null
): { ok: true; mcpServers: Record<string, unknown> } | { ok: false; error: DriftError } {
  if (raw === null) {
    // No file at all is not malformed - it just means every owned key is 'missing'.
    return { ok: true, mcpServers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    return { ok: false, error: malformedConfigStructureError(configPath, `file does not parse as JSON: ${err.message}`) };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: malformedConfigStructureError(configPath, 'top-level content is not a JSON object') };
  }

  const mcpServers = (parsed as Record<string, unknown>).mcpServers;
  if (mcpServers === undefined) {
    // No mcpServers key at all is not malformed - every owned key is 'missing'.
    return { ok: true, mcpServers: {} };
  }
  if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) {
    return { ok: false, error: malformedConfigStructureError(configPath, '"mcpServers" exists but is not an object') };
  }

  return { ok: true, mcpServers: mcpServers as Record<string, unknown> };
}

function classify(row: OwnershipRow, mcpServers: Record<string, unknown>): DriftEntry {
  const liveValue = mcpServers[row.config_key];
  const hasLiveValue = row.config_key in mcpServers;

  if (row.last_written_value === null) {
    return {
      server_id: row.server_id,
      client_id: row.client_id,
      config_key: row.config_key,
      config_file_path: row.config_file_path,
      status: 'unverifiable',
      storedSnapshot: undefined,
      liveValue: hasLiveValue ? liveValue : undefined,
    };
  }

  const storedSnapshot = JSON.parse(row.last_written_value);

  if (!hasLiveValue) {
    return {
      server_id: row.server_id,
      client_id: row.client_id,
      config_key: row.config_key,
      config_file_path: row.config_file_path,
      status: 'missing',
      storedSnapshot,
      liveValue: undefined,
    };
  }

  const status: DriftStatus = valuesEqual(storedSnapshot, liveValue) ? 'unchanged' : 'changed';
  return {
    server_id: row.server_id,
    client_id: row.client_id,
    config_key: row.config_key,
    config_file_path: row.config_file_path,
    status,
    storedSnapshot,
    liveValue,
  };
}

export function detectDriftForPair(db: SqliteDatabase, server_id: string, client_id: string): DriftCheckResult {
  const row = getOwnershipRow(db, server_id, client_id);
  if (!row) {
    throw new Error(`No ownership record for ${server_id} on ${client_id} - nothing to check for drift.`);
  }

  const raw = readConfigFile(row.config_file_path);
  const structureResult = validateConfigStructure(row.config_file_path, raw);
  if (!structureResult.ok) return { ok: false, error: structureResult.error };

  return { ok: true, entry: classify(row, structureResult.mcpServers) };
}

/** Every ownership row across every (server, client) pair, classified. Config files are read once per unique path. */
export function detectAllDrift(db: SqliteDatabase): { server_id: string; client_id: string; result: DriftCheckResult }[] {
  const rows = getAllOwnershipRows(db);
  const structureCache = new Map<string, { ok: true; mcpServers: Record<string, unknown> } | { ok: false; error: DriftError }>();

  return rows.map((row) => {
    let structureResult = structureCache.get(row.config_file_path);
    if (!structureResult) {
      const raw = readConfigFile(row.config_file_path);
      structureResult = validateConfigStructure(row.config_file_path, raw);
      structureCache.set(row.config_file_path, structureResult);
    }

    const result: DriftCheckResult = structureResult.ok
      ? { ok: true, entry: classify(row, structureResult.mcpServers) }
      : { ok: false, error: structureResult.error };

    return { server_id: row.server_id, client_id: row.client_id, result };
  });
}
