import type { SqliteDatabase } from './db.js';
import type { CapabilityDiffRow, RiskLevel } from './types.js';

const now = () => Math.floor(Date.now() / 1000);

/**
 * Persist a full CapabilityDiff (from Phase B) as durable, queryable, re-renderable
 * history. Stores the complete structured object, not a lossy summary.
 */
export function insertDiff(
  db: SqliteDatabase,
  from_manifest_id: number,
  to_manifest_id: number,
  diff: unknown, // the full CapabilityDiff object from @scopewatch/diff-engine
  newly_destructive: boolean,
  risk_level: RiskLevel,
  rendered_summary?: string
): number {
  const result = db
    .prepare(
      `INSERT INTO capability_diffs
        (from_manifest_id, to_manifest_id, diff_json, newly_destructive, risk_level, rendered_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      from_manifest_id,
      to_manifest_id,
      JSON.stringify(diff),
      newly_destructive ? 1 : 0,
      risk_level,
      rendered_summary ?? null,
      now()
    );
  return Number(result.lastInsertRowid);
}

export function getDiff(db: SqliteDatabase, id: number): CapabilityDiffRow | null {
  return (db.prepare('SELECT * FROM capability_diffs WHERE id = ?').get(id) as CapabilityDiffRow) ?? null;
}

/** Re-hydrate the full structured CapabilityDiff object for re-rendering. */
export function getDiffObject(db: SqliteDatabase, id: number): unknown | null {
  const row = getDiff(db, id);
  return row ? JSON.parse(row.diff_json) : null;
}

/** Audit query: all diffs ever computed, for compliance / "what did I approve" queries. */
export function listDiffsByRisk(db: SqliteDatabase, risk_level: RiskLevel): CapabilityDiffRow[] {
  return db.prepare('SELECT * FROM capability_diffs WHERE risk_level = ? ORDER BY created_at ASC').all(
    risk_level
  ) as CapabilityDiffRow[];
}
