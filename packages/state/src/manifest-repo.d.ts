import type { SqliteDatabase } from './db.js';
import type { ManifestRow } from './types.js';
/** Insert a manifest version. manifest_json is expected to be normalized/validated JSON. */
export declare function insertManifest(db: SqliteDatabase, server_id: string, version: string, source_type: 'npm' | 'git' | 'local', source_location: string, checksum: string, manifest_json: string): number;
export declare function getManifest(db: SqliteDatabase, id: number): ManifestRow | null;
export declare function getManifestByVersion(db: SqliteDatabase, server_id: string, version: string): ManifestRow | null;
//# sourceMappingURL=manifest-repo.d.ts.map