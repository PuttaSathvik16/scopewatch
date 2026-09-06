import type { SqliteDatabase } from './db.js';

const now = () => Math.floor(Date.now() / 1000);

export type OwnershipRow = {
  id: number;
  server_id: string;
  client_id: string;
  config_file_path: string;
  config_key: string;
  last_written_value: string | null;
  created_at: number;
};

/**
 * Record (upsert) that Scopewatch owns this config key for this (server,
 * client) pair, along with the EXACT serialized value written - this is the
 * snapshot drift detection compares the live file against later. Always
 * pass a real value here; NULL only ever occurs via the migration 004
 * backfill for pre-existing rows that have no real historical snapshot.
 */
export function recordOwnership(
  db: SqliteDatabase,
  server_id: string,
  client_id: string,
  config_file_path: string,
  config_key: string,
  last_written_value: string
): void {
  db.prepare(
    `INSERT INTO client_config_ownership (server_id, client_id, config_file_path, config_key, last_written_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, client_id) DO UPDATE SET
       config_file_path = excluded.config_file_path,
       config_key = excluded.config_key,
       last_written_value = excluded.last_written_value`
  ).run(server_id, client_id, config_file_path, config_key, last_written_value, now());
}

/** All config keys Scopewatch owns within a given client's config file. */
export function getOwnedKeys(db: SqliteDatabase, client_id: string, config_file_path: string): Set<string> {
  const rows = db
    .prepare('SELECT config_key FROM client_config_ownership WHERE client_id = ? AND config_file_path = ?')
    .all(client_id, config_file_path) as { config_key: string }[];
  return new Set(rows.map((r) => r.config_key));
}

/** The full ownership row for a (server, client) pair, including its snapshot - or null if none exists. */
export function getOwnershipRow(db: SqliteDatabase, server_id: string, client_id: string): OwnershipRow | null {
  return (
    (db.prepare('SELECT * FROM client_config_ownership WHERE server_id = ? AND client_id = ?').get(server_id, client_id) as
      | OwnershipRow
      | undefined) ?? null
  );
}

/** Every ownership row across all (server, client) pairs - used by drift detection to iterate everything owned. */
export function getAllOwnershipRows(db: SqliteDatabase): OwnershipRow[] {
  return db.prepare('SELECT * FROM client_config_ownership').all() as OwnershipRow[];
}

/** Update just the stored snapshot for a (server, client) pair - used when a drift resolution adopts the live value as the new baseline. */
export function updateOwnershipSnapshot(db: SqliteDatabase, server_id: string, client_id: string, last_written_value: string): void {
  db.prepare('UPDATE client_config_ownership SET last_written_value = ? WHERE server_id = ? AND client_id = ?').run(
    last_written_value,
    server_id,
    client_id
  );
}

export function removeOwnership(db: SqliteDatabase, server_id: string, client_id: string): void {
  db.prepare('DELETE FROM client_config_ownership WHERE server_id = ? AND client_id = ?').run(server_id, client_id);
}
