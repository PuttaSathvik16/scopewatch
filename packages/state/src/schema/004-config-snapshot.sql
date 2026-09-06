-- Adds last_written_value: the EXACT serialized JSON of a config entry as
-- actually written, captured at write time. Drift detection (Phase H)
-- compares the live file against THIS stored snapshot - never a freshly
-- regenerated value - so detection stays correct even if the config
-- generation logic itself changes later.
--
-- last_written_value is NULLABLE, deliberately. Pre-migration ownership rows
-- have no real historical snapshot - this migration is a pure DB
-- transformation and must not reach out to the filesystem to fabricate one.
-- NULL means "no real snapshot was ever recorded for this row," and drift
-- detection must treat that as its own distinct status ('unverifiable'),
-- never as if NULL (or any placeholder) were a genuine prior value. Backfilling
-- with a fabricated value like '{}' would let a user "restore" that fake
-- snapshot over their real, working config entry - a real destructive-action
-- hazard, not just a cosmetic false positive. See drift.ts for how
-- 'unverifiable' rows are handled (adopt-current-value only; restore is
-- refused).
PRAGMA foreign_keys = OFF;

CREATE TABLE client_config_ownership_new (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  config_file_path TEXT NOT NULL,
  config_key TEXT NOT NULL,
  last_written_value TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(server_id, client_id),
  UNIQUE(client_id, config_file_path, config_key)
);

INSERT INTO client_config_ownership_new (id, server_id, client_id, config_file_path, config_key, last_written_value, created_at)
  SELECT id, server_id, client_id, config_file_path, config_key, NULL, created_at FROM client_config_ownership;

DROP TABLE client_config_ownership;
ALTER TABLE client_config_ownership_new RENAME TO client_config_ownership;

CREATE INDEX idx_ownership_client_file ON client_config_ownership(client_id, config_file_path);

PRAGMA foreign_keys = ON;
