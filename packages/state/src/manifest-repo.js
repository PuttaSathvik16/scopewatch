const now = () => Math.floor(Date.now() / 1000);
/** Insert a manifest version. manifest_json is expected to be normalized/validated JSON. */
export function insertManifest(db, server_id, version, source_type, source_location, checksum, manifest_json) {
    const result = db
        .prepare(`INSERT INTO manifests (server_id, version, source_type, source_location, checksum, manifest_json, inserted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(server_id, version, source_type, source_location, checksum, manifest_json, now());
    return Number(result.lastInsertRowid);
}
export function getManifest(db, id) {
    return db.prepare('SELECT * FROM manifests WHERE id = ?').get(id) ?? null;
}
export function getManifestByVersion(db, server_id, version) {
    return (db.prepare('SELECT * FROM manifests WHERE server_id = ? AND version = ?').get(server_id, version) ??
        null);
}
//# sourceMappingURL=manifest-repo.js.map