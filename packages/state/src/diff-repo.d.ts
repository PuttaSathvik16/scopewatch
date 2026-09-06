import type { SqliteDatabase } from './db.js';
import type { CapabilityDiffRow, RiskLevel } from './types.js';
/**
 * Persist a full CapabilityDiff (from Phase B) as durable, queryable, re-renderable
 * history. Stores the complete structured object, not a lossy summary.
 */
export declare function insertDiff(db: SqliteDatabase, from_manifest_id: number, to_manifest_id: number, diff: unknown, // the full CapabilityDiff object from @scopewatch/diff-engine
newly_destructive: boolean, risk_level: RiskLevel, rendered_summary?: string): number;
export declare function getDiff(db: SqliteDatabase, id: number): CapabilityDiffRow | null;
/** Re-hydrate the full structured CapabilityDiff object for re-rendering. */
export declare function getDiffObject(db: SqliteDatabase, id: number): unknown | null;
/** Audit query: all diffs ever computed, for compliance / "what did I approve" queries. */
export declare function listDiffsByRisk(db: SqliteDatabase, risk_level: RiskLevel): CapabilityDiffRow[];
//# sourceMappingURL=diff-repo.d.ts.map