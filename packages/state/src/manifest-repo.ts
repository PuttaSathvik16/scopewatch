import type { SqliteDatabase } from './db.js';
import type { ManifestRow } from './types.js';

const now = () => Math.floor(Date.now() / 1000);

/** Insert a manifest version. manifest_json is expected to be normalized/validated JSON. */
export function insertManifest(
  db: SqliteDatabase,
  server_id: string,
  version: string,
  source_type: 'npm' | 'git' | 'local',
  source_location: string,
  checksum: string,
  manifest_json: string
): number {
  const result = db
    .prepare(
      `INSERT INTO manifests (server_id, version, source_type, source_location, checksum, manifest_json, inserted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(server_id, version, source_type, source_location, checksum, manifest_json, now());
  return Number(result.lastInsertRowid);
}

export function getManifest(db: SqliteDatabase, id: number): ManifestRow | null {
  return (db.prepare('SELECT * FROM manifests WHERE id = ?').get(id) as ManifestRow) ?? null;
}

export function getManifestByVersion(db: SqliteDatabase, server_id: string, version: string): ManifestRow | null {
  return (
    (db.prepare('SELECT * FROM manifests WHERE server_id = ? AND version = ?').get(server_id, version) as ManifestRow) ??
    null
  );
}
