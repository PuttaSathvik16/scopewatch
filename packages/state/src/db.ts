import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, 'schema');

export type SqliteDatabase = Database.Database;

/**
 * The single, machine-wide state database location. Local-first: one DB
 * tracks every installed server across every project and client, not one
 * per project. Creates the containing directory if it doesn't exist yet.
 *
 * Respects SCOPEWATCH_STATE_DIR when set, overriding ~/.scopewatch - this
 * exists so a real-subprocess integration test can run the actual compiled
 * CLI binary without ever touching the real user's home directory state.
 * Off by default; same dependency-injection philosophy used everywhere
 * else in this codebase (CommandRunner, FetchFn, SpawnFn), just applied at
 * the OS-process boundary since a spawned subprocess can't be code-injected.
 */
export function defaultDbPath(): string {
  const dir = process.env.SCOPEWATCH_STATE_DIR ?? join(homedir(), '.scopewatch');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'state.db');
}

/**
 * Open (or create) a SQLite database at the given path and run any pending migrations.
 * Migrations are numbered .sql files in src/schema/, applied in order, each in its own transaction.
 */
export function openDatabase(filePath: string): SqliteDatabase {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function runMigrations(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      migrated_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version)
  );

  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // "001-...", "002-..." sort lexicographically in the right order

  for (const file of files) {
    const version = parseInt(file.split('-')[0]!, 10);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(SCHEMA_DIR, file), 'utf-8');

    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, migrated_at) VALUES (?, ?)').run(
        version,
        Math.floor(Date.now() / 1000)
      );
    });

    runMigration();
  }
}
