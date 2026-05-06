import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { JlptEntry, JlptRepo } from '@main/db/repos/jlpt-repo';
import bundledSeed from '../../data/jlpt-levels.json';

const USER_OVERRIDE_FILENAME = 'jlpt-levels.json';

function coerceEntries(parsed: unknown): JlptEntry[] {
  if (!Array.isArray(parsed)) return [];
  const out: JlptEntry[] = [];
  for (const row of parsed) {
    if (
      typeof row === 'object' &&
      row !== null &&
      typeof (row as Record<string, unknown>).key === 'string' &&
      typeof (row as Record<string, unknown>).level === 'number'
    ) {
      out.push({
        key: (row as JlptEntry).key,
        level: (row as JlptEntry).level,
      });
    }
  }
  return out;
}

function readJsonSafe(p: string): JlptEntry[] | null {
  try {
    const txt = fs.readFileSync(p, 'utf-8');
    return coerceEntries(JSON.parse(txt));
  } catch {
    return null;
  }
}

/**
 * Loads JLPT level data into SQLite. Prefers a user override at
 * `<userData>/jlpt-levels.json` if present; otherwise falls back to the
 * bundled seed (which ships empty by default).
 */
export function importJlpt(repo: JlptRepo): { source: 'user' | 'bundled' | 'none'; loaded: number } {
  const userPath = path.join(app.getPath('userData'), USER_OVERRIDE_FILENAME);
  const userEntries = fs.existsSync(userPath) ? readJsonSafe(userPath) : null;

  if (userEntries && userEntries.length > 0) {
    repo.bulkInsert(userEntries);
    return { source: 'user', loaded: userEntries.length };
  }

  const seedEntries = coerceEntries(bundledSeed);
  if (seedEntries.length > 0) {
    repo.bulkInsert(seedEntries);
    return { source: 'bundled', loaded: seedEntries.length };
  }

  return { source: 'none', loaded: 0 };
}
