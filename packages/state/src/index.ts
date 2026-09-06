export { openDatabase, defaultDbPath } from './db.js';
export type { SqliteDatabase } from './db.js';
export { LifecycleEngine } from './lifecycle-engine.js';
export { insertManifest, getManifest, getManifestByVersion, getCurrentManifestFor } from './manifest-repo.js';
export { insertDiff, getDiff, getDiffObject, listDiffsByRisk } from './diff-repo.js';
export { recordOwnership, getOwnedKeys, removeOwnership } from './ownership-repo.js';
export type { OwnershipRow } from './ownership-repo.js';
export type {
  LifecycleState,
  EventType,
  RiskLevel,
  ManifestRow,
  LockfileEntryRow,
  CapabilityDiffRow,
  RollbackCheckpointRow,
  LifecycleEventRow,
  Intent,
} from './types.js';
