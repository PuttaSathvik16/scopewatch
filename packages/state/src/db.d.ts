import Database from 'better-sqlite3';
export type SqliteDatabase = Database.Database;
/**
 * Open (or create) a SQLite database at the given path and run any pending migrations.
 * Migrations are numbered .sql files in src/schema/, applied in order, each in its own transaction.
 */
export declare function openDatabase(filePath: string): SqliteDatabase;
//# sourceMappingURL=db.d.ts.map