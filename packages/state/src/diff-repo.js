const now = () => Math.floor(Date.now() / 1000);
/**
 * Persist a full CapabilityDiff (from Phase B) as durable, queryable, re-renderable
 * history. Stores the complete structured object, not a lossy summary.
 */
export function insertDiff(db, from_manifest_id, to_manifest_id, diff, // the full CapabilityDiff object from @scopewatch/diff-engine
newly_destructive, risk_level, rendered_summary) {
    const result = db
        .prepare(`INSERT INTO capability_diffs
        (from_manifest_id, to_manifest_id, diff_json, newly_destructive, risk_level, rendered_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(from_manifest_id, to_manifest_id, JSON.stringify(diff), newly_destructive ? 1 : 0, risk_level, rendered_summary ?? null, now());
    return Number(result.lastInsertRowid);
}
export function getDiff(db, id) {
    return db.prepare('SELECT * FROM capability_diffs WHERE id = ?').get(id) ?? null;
}
/** Re-hydrate the full structured CapabilityDiff object for re-rendering. */
export function getDiffObject(db, id) {
    const row = getDiff(db, id);
    return row ? JSON.parse(row.diff_json) : null;
}
/** Audit query: all diffs ever computed, for compliance / "what did I approve" queries. */
export function listDiffsByRisk(db, risk_level) {
    return db.prepare('SELECT * FROM capability_diffs WHERE risk_level = ? ORDER BY created_at ASC').all(risk_level);
}
//# sourceMappingURL=diff-repo.js.map