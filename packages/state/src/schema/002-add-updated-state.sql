-- Add the missing 'updated' lifecycle state to the CHECK constraints on
-- lockfile_entries.state, rollback_checkpoints.state_at_checkpoint, and
-- lifecycle_events.from_state/to_state.
--
-- 'updated' is the state for showing a diff when an already-ACTIVE server has a
-- new version available (distinct from 'reviewed', the pre-install review state).
-- It was present in the original lifecycle brief but omitted from migration 001's
-- CHECK constraints by mistake. SQLite cannot ALTER a CHECK constraint in place,
-- so each affected table is recreated with the corrected constraint and existing
-- rows are copied across.

PRAGMA foreign_keys = OFF;

-- lockfile_entries
CREATE TABLE lockfile_entries_new (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  manifest_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('discovered','reviewed','installed','configured','validated','active','updated','disabled','removed')),
  last_diff_id INTEGER,
  activated_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(manifest_id) REFERENCES manifests(id),
  FOREIGN KEY(last_diff_id) REFERENCES capability_diffs(id),
  UNIQUE(server_id, client_id)
);
INSERT INTO lockfile_entries_new SELECT * FROM lockfile_entries;
DROP TABLE lockfile_entries;
ALTER TABLE lockfile_entries_new RENAME TO lockfile_entries;
CREATE INDEX idx_lockfile_server_client ON lockfile_entries(server_id, client_id);

-- rollback_checkpoints
CREATE TABLE rollback_checkpoints_new (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  manifest_id INTEGER NOT NULL,
  state_at_checkpoint TEXT NOT NULL CHECK(state_at_checkpoint IN ('discovered','reviewed','installed','configured','validated','active','updated','disabled','removed')),
  checkpoint_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  FOREIGN KEY(manifest_id) REFERENCES manifests(id)
);
INSERT INTO rollback_checkpoints_new SELECT * FROM rollback_checkpoints;
DROP TABLE rollback_checkpoints;
ALTER TABLE rollback_checkpoints_new RENAME TO rollback_checkpoints;

-- lifecycle_events
CREATE TABLE lifecycle_events_new (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  diff_id INTEGER,
  from_state TEXT NOT NULL CHECK(from_state IN ('discovered','reviewed','installed','configured','validated','active','updated','disabled','removed')),
  to_state TEXT NOT NULL CHECK(to_state IN ('discovered','reviewed','installed','configured','validated','active','updated','disabled','removed')),
  event_type TEXT NOT NULL CHECK(event_type IN ('transition_intent','transition_confirmed','transition_failed','recovery','rollback')),
  resolves_intent_id INTEGER REFERENCES lifecycle_events_new(id),
  pending_side_effects TEXT,
  error_message TEXT,
  checkpoint_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(diff_id) REFERENCES capability_diffs(id),
  FOREIGN KEY(checkpoint_id) REFERENCES rollback_checkpoints(id)
);
INSERT INTO lifecycle_events_new SELECT * FROM lifecycle_events;
DROP TABLE lifecycle_events;
ALTER TABLE lifecycle_events_new RENAME TO lifecycle_events;

CREATE INDEX idx_events_server_client_time ON lifecycle_events(server_id, client_id, created_at);
CREATE INDEX idx_events_server_client_from_state ON lifecycle_events(server_id, client_id, from_state);
CREATE INDEX idx_events_diff_id ON lifecycle_events(diff_id);
CREATE INDEX idx_intent_resolution ON lifecycle_events(resolves_intent_id);

PRAGMA foreign_keys = ON;
