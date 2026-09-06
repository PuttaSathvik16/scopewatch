-- Tracks which config keys (within a client's mcpServers object) Scopewatch
-- itself wrote, so the config writer can be certain never to touch a key it
-- doesn't own - deterministic, not guessed from file content.
--
-- Scope note (Phase F, not yet Phase H): this table protects OTHER people's
-- keys from ever being touched. It does NOT detect drift within a key
-- Scopewatch itself owns - if a human hand-edits the "args" of an entry
-- Scopewatch created, this table still considers that key "ours" and the
-- next write will overwrite the hand-edit with no detection. That drift
-- detection is the client drift reconciler's job (Phase H), not this one.
CREATE TABLE client_config_ownership (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  config_file_path TEXT NOT NULL,
  config_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(server_id, client_id),
  UNIQUE(client_id, config_file_path, config_key)
);

CREATE INDEX idx_ownership_client_file ON client_config_ownership(client_id, config_file_path);
