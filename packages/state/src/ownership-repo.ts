import type { SqliteDatabase } from './db.js';

const now = () => Math.floor(Date.now() / 1000);

export type OwnershipRow = {
  id: number;
  server_id: string;
  client_id: string;
  config_file_path: string;
  config_key: string;
  created_at: number;
};

/** Record (upsert) that Scopewatch owns this config key for this (server, client) pair. */
export function recordOwnership(
  db: SqliteDatabase,
  server_id: string,
  client_id: string,
  config_file_path: string,
  config_key: string
): void {
  db.prepare(
    `INSERT INTO client_config_ownership (server_id, client_id, config_file_path, config_key, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id, client_id) DO UPDATE SET
       config_file_path = excluded.config_file_path,
       config_key = excluded.config_key`
  ).run(server_id, client_id, config_file_path, config_key, now());
}

/** All config keys Scopewatch owns within a given client's config file. */
export function getOwnedKeys(db: SqliteDatabase, client_id: string, config_file_path: string): Set<string> {
  const rows = db
    .prepare('SELECT config_key FROM client_config_ownership WHERE client_id = ? AND config_file_path = ?')
    .all(client_id, config_file_path) as { config_key: string }[];
  return new Set(rows.map((r) => r.config_key));
}

export function removeOwnership(db: SqliteDatabase, server_id: string, client_id: string): void {
  db.prepare('DELETE FROM client_config_ownership WHERE server_id = ? AND client_id = ?').run(server_id, client_id);
}
