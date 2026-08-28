import { createRequire } from 'node:module';

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): SqliteStatement;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
}

interface SqliteConstructor {
  new (path: string): SqliteDatabase;
}

export function openSqlite(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const loaded = require('better-sqlite3') as SqliteConstructor | { default: SqliteConstructor };
  const Database = typeof loaded === 'function' ? loaded : loaded.default;
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  return database;
}
