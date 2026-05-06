import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'jrc.sqlite');
}

export function openDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
