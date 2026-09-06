import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, 'schema');
/**
 * Open (or create) a SQLite database at the given path and run any pending migrations.
 * Migrations are numbered .sql files in src/schema/, applied in order, each in its own transaction.
 */
export function openDatabase(filePath) {
    const db = new Database(filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
}
function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      migrated_at INTEGER NOT NULL
    );
  `);
    const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
    const files = readdirSync(SCHEMA_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // "001-...", "002-..." sort lexicographically in the right order
    for (const file of files) {
        const version = parseInt(file.split('-')[0], 10);
        if (applied.has(version))
            continue;
        const sql = readFileSync(join(SCHEMA_DIR, file), 'utf-8');
        const runMigration = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version, migrated_at) VALUES (?, ?)').run(version, Math.floor(Date.now() / 1000));
        });
        runMigration();
    }
}
//# sourceMappingURL=db.js.map