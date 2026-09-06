import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Imported BY PACKAGE NAME - this is a permanent regression guard for the
// exact bug this test suite exists to prevent from recurring: db.ts resolves
// its migrations directory relative to import.meta.url, which only pointed at
// the real schema/*.sql files when running against .ts source directly. Every
// other test in this package's own test/ directory used '../src/...', so none
// of them ever caught that dist/schema/ was never populated by the build.
// This was only discovered when @scopewatch/secrets imported this package by
// name for the first time. This test makes that discovery permanent instead
// of a one-off catch.
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';

test('dist smoke: @scopewatch/state opens a real database and runs migrations through compiled output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-dist-smoke-'));
  const dbPath = join(dir, 'state.db');

  try {
    const db = openDatabase(dbPath);

    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[];
    ok(migrations.length >= 2, `Expected at least 2 migrations applied via compiled dist/, got: ${migrations.length}`);

    const manifestId = insertManifest(db, 'smoke-server', '1.0.0', 'npm', 'smoke-server', 'sha256:smoke', '{}');
    ok(manifestId > 0);

    const engine = new LifecycleEngine(db);
    const intentId = engine.startTransition('smoke-server', 'claude-code', 'discovered', 'reviewed', null);
    engine.confirmTransition(intentId, manifestId);

    strictEqual(engine.getState('smoke-server', 'claude-code'), 'reviewed', 'lifecycle transition should work through compiled dist/');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
