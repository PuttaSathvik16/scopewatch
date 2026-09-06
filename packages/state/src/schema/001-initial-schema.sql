-- Manifests: versioned server capability snapshots
CREATE TABLE manifests (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('npm','git','local')),
  source_location TEXT NOT NULL,
  checksum TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  inserted_at INTEGER NOT NULL,
  UNIQUE(server_id, version)
);

-- Capability diffs: full diff history, queryable and re-renderable indefinitely.
-- Stores the complete structured CapabilityDiff object from Phase B, not a lossy summary.
CREATE TABLE capability_diffs (
  id INTEGER PRIMARY KEY,
  from_manifest_id INTEGER NOT NULL,
  to_manifest_id INTEGER NOT NULL,
  diff_json TEXT NOT NULL,
  newly_destructive INTEGER NOT NULL CHECK(newly_destructive IN (0,1)),
  risk_level TEXT NOT NULL CHECK(risk_level IN ('none','low','medium','high')),
  rendered_summary TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(from_manifest_id) REFERENCES manifests(id),
  FOREIGN KEY(to_manifest_id) REFERENCES manifests(id),
  UNIQUE(from_manifest_id, to_manifest_id)
);

-- Lockfile entries: UPSERT-ONLY table. One row per (server_id, client_id) pair,
-- representing CURRENT state. Full history lives in lifecycle_events + capability_diffs.
-- Never insert a second row for the same pair; always UPDATE the existing row.
CREATE TABLE lockfile_entries (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  manifest_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('discovered','reviewed','installed','configured','validated','active','disabled','removed')),
  last_diff_id INTEGER,
  activated_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(manifest_id) REFERENCES manifests(id),
  FOREIGN KEY(last_diff_id) REFERENCES capability_diffs(id),
  UNIQUE(server_id, client_id)
);

-- Rollback checkpoints: snapshots created before a server moves AWAY from 'active'
-- (i.e., before an update begins). Used by explicit rollback and by crash recovery
-- when an unresolved intent's transition had one.
CREATE TABLE rollback_checkpoints (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  manifest_id INTEGER NOT NULL,
  state_at_checkpoint TEXT NOT NULL CHECK(state_at_checkpoint IN ('discovered','reviewed','installed','configured','validated','active','disabled','removed')),
  checkpoint_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  FOREIGN KEY(manifest_id) REFERENCES manifests(id)
);

-- Lifecycle events: append-only event log. Every transition, intent, confirmation,
-- failure, rollback, and recovery action is recorded here permanently.
CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  diff_id INTEGER,
  from_state TEXT NOT NULL CHECK(from_state IN ('discovered','reviewed','installed','configured','validated','active','disabled','removed')),
  to_state TEXT NOT NULL CHECK(to_state IN ('discovered','reviewed','installed','configured','validated','active','disabled','removed')),
  event_type TEXT NOT NULL CHECK(event_type IN ('transition_intent','transition_confirmed','transition_failed','recovery','rollback')),
  resolves_intent_id INTEGER REFERENCES lifecycle_events(id),
  pending_side_effects TEXT,
  error_message TEXT,
  checkpoint_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(diff_id) REFERENCES capability_diffs(id),
  FOREIGN KEY(checkpoint_id) REFERENCES rollback_checkpoints(id)
);

CREATE INDEX idx_lockfile_server_client ON lockfile_entries(server_id, client_id);
CREATE INDEX idx_events_server_client_time ON lifecycle_events(server_id, client_id, created_at);
CREATE INDEX idx_events_server_client_from_state ON lifecycle_events(server_id, client_id, from_state);
CREATE INDEX idx_events_diff_id ON lifecycle_events(diff_id);
CREATE INDEX idx_intent_resolution ON lifecycle_events(resolves_intent_id);
CREATE INDEX idx_diffs_manifests ON capability_diffs(from_manifest_id, to_manifest_id);
