import { Inflate } from 'pako';
import sax from 'sax';
import type { DictStatus, DictImportPhase } from '@shared/ipc';
import type {
  JmdictEntry,
  JmdictSense,
  JmdictExample,
} from '@shared/types/jmdict';
import { runTransaction, query, db } from './capacitor-db';

const JMDICT_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 200;

// ----- status broadcaster ---------------------------------------------------

let currentStatus: DictStatus = { kind: 'unknown' };
const listeners = new Set<(s: DictStatus) => void>();

function setStatus(s: DictStatus): void {
  currentStatus = s;
  for (const cb of listeners) cb(s);
}

export function getCachedStatus(): DictStatus {
  return currentStatus;
}

export function subscribeStatus(cb: (s: DictStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Initialize the cached status from the DB so the renderer doesn't see a
 * spurious 'unknown' on cold-start when JMdict is already imported. The
 * renderer treats 'unknown' as "still asking" and shows a blank loading
 * screen, so when JMdict is genuinely missing we must return
 * 'needs-import' to surface the SetupPage.
 */
export async function refreshStatusFromDb(): Promise<DictStatus> {
  if (currentStatus.kind === 'importing') return currentStatus;
  try {
    const rows = await query<{ c: number }>(
      'SELECT COUNT(*) AS c FROM jmdict_entries',
    );
    const count = rows[0]?.c ?? 0;
    currentStatus =
      count > 0
        ? { kind: 'ready', entryCount: count }
        : { kind: 'needs-import' };
  } catch {
    currentStatus = { kind: 'needs-import' };
  }
  return currentStatus;
}

// ----- importer -------------------------------------------------------------

let inFlight: Promise<void> | null = null;

export function importJmdict(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = doImport().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doImport(): Promise<void> {
  const setPhase = (
    phase: DictImportPhase,
    extra?: Partial<Extract<DictStatus, { kind: 'importing' }>>,
  ): void => {
    setStatus({ kind: 'importing', phase, ...extra });
  };

  try {
    setPhase('downloading', { received: 0 });

    const res = await fetch(JMDICT_URL);
    if (!res.ok || !res.body) {
      throw new Error(
        `JMdict download failed: ${res.status} ${res.statusText}`,
      );
    }
    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? Number(totalHeader) : null;

    // Wipe the existing tables before refilling. Doing this after a
    // successful download means a failed download leaves the previous
    // dictionary intact.
    await runTransaction([
      { statement: 'DELETE FROM jmdict_index' },
      { statement: 'DELETE FROM jmdict_entries' },
    ]);

    // ---- streaming pipeline -------------------------------------------------
    // bytes (gzipped) -> pako Inflate -> utf-8 text -> sax parser -> entries
    // We feed pako one HTTP chunk at a time. Pako emits decompressed text
    // chunks via onData, which we hand to the sax parser. Sax in turn calls
    // onclosetag('entry') for every parsed dictionary entry.

    const parser = createSaxParser();
    let entriesParsed = 0;
    let lastReportedEntries = 0;
    let received = 0;
    let buffer: JmdictEntry[] = [];
    let pendingFlush: Promise<void> = Promise.resolve();

    parser.onEntry = (entry: JmdictEntry): void => {
      buffer.push(entry);
      entriesParsed++;
      if (buffer.length >= BATCH_SIZE) {
        const batch = buffer;
        buffer = [];
        // Serialize batch flushes so we don't blow the SQLite worker queue.
        pendingFlush = pendingFlush.then(() => bulkInsert(batch));
      }
      if (entriesParsed - lastReportedEntries >= PROGRESS_EVERY) {
        lastReportedEntries = entriesParsed;
        setPhase('parsing', { entries: entriesParsed });
      }
    };

    const inflate = new Inflate({ to: 'string' });
    // pako's `Data` type covers string | Uint8Array | ArrayBuffer. With
    // `{ to: 'string' }` the runtime always emits strings, so we coerce
    // the union here rather than threading three branches everywhere.
    inflate.onData = (chunk) => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? utf8Decode(chunk)
            : utf8Decode(new Uint8Array(chunk));
      parser.write(text);
    };

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      setPhase('downloading', {
        received,
        ...(total != null ? { total } : {}),
      });
      // Pako handles backpressure synchronously; just push and let it call
      // onData. Final flag stays false until the last chunk.
      inflate.push(value, false);
      if (inflate.err) {
        throw new Error(`gunzip failed: ${inflate.msg ?? 'unknown'}`);
      }
    }
    // Final flush: push an empty chunk with final=true so pako emits any
    // remaining data and signals end-of-stream.
    inflate.push(new Uint8Array(0), true);
    if (inflate.err) {
      throw new Error(`gunzip failed: ${inflate.msg ?? 'unknown'}`);
    }
    parser.close();

    // Wait for any in-flight batch to finish, then flush whatever's left.
    await pendingFlush;
    if (buffer.length > 0) {
      await bulkInsert(buffer);
      buffer = [];
    }

    setPhase('finalizing', { entries: entriesParsed });

    const finalCount = await countEntries();
    setStatus({ kind: 'ready', entryCount: finalCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setStatus({ kind: 'failed', error: message });
    throw e;
  }
}

// ----- sax parser wrapper (mirrors src/main/services/dictionary/jmdict-parser.ts) ----

const ENTITY_LITERAL_RE = /^&([A-Za-z0-9_-]+);$/;
function stripEntityIfLiteral(value: string): string {
  const m = value.match(ENTITY_LITERAL_RE);
  return m ? (m[1] ?? value) : value;
}

interface SaxWrapper {
  write(chunk: string): void;
  close(): void;
  onEntry: (entry: JmdictEntry) => void;
}

function createSaxParser(): SaxWrapper {
  // Lax, lowercase, normalize whitespace — same flags as the Mac parser.
  const parser = sax.parser(false, {
    trim: true,
    normalize: true,
    lowercase: true,
  });

  let inEntry = false;
  let currentEntry: JmdictEntry | null = null;
  let inKEle = false;
  let inREle = false;
  let inSense = false;
  let currentSense: JmdictSense | null = null;
  let inExample = false;
  let currentExample: JmdictExample | null = null;
  let textBuffer = '';

  const wrapper: SaxWrapper = {
    write(chunk) {
      parser.write(chunk);
    },
    close() {
      parser.close();
    },
    onEntry: () => {},
  };

  parser.ondoctype = (doctype: string) => {
    // JMdict's DTD declares ~100 entity references for parts of speech
    // (`&n;`, `&v5k;`, …). sax doesn't read the DOCTYPE entity table, so
    // we extract the names and re-bind each to its short tag. As a
    // belt-and-suspenders, stripEntityIfLiteral handles any that slip
    // through into text content.
    const entityRegex = /<!ENTITY\s+(\S+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
    const entitiesRecord = (
      parser as unknown as { ENTITIES: Record<string, string> }
    ).ENTITIES;
    let match;
    while ((match = entityRegex.exec(doctype)) !== null) {
      const name = match[1];
      if (name) entitiesRecord[name] = name;
    }
  };

  parser.onopentag = (node) => {
    const name = node.name;
    if (name === 'entry') {
      inEntry = true;
      currentEntry = { entSeq: 0, kanji: [], readings: [], senses: [] };
      textBuffer = '';
      return;
    }
    if (!inEntry) return;
    if (name === 'k_ele') inKEle = true;
    else if (name === 'r_ele') inREle = true;
    else if (name === 'sense') {
      inSense = true;
      currentSense = { pos: [], glosses: [] };
    } else if (name === 'example' && currentSense) {
      inExample = true;
      currentExample = { japanese: '', translations: [] };
    }
    textBuffer = '';
  };

  parser.ontext = (text) => {
    if (inEntry) textBuffer += text;
  };

  parser.onclosetag = (name) => {
    if (name === 'entry') {
      if (currentEntry) wrapper.onEntry(currentEntry);
      currentEntry = null;
      inEntry = false;
      textBuffer = '';
      return;
    }
    if (!inEntry || !currentEntry) {
      textBuffer = '';
      return;
    }
    const value = textBuffer.trim();
    textBuffer = '';

    if (name === 'ent_seq') {
      currentEntry.entSeq = Number(value);
    } else if (name === 'keb' && inKEle) {
      if (value) currentEntry.kanji.push(value);
    } else if (name === 'reb' && inREle) {
      if (value) currentEntry.readings.push(value);
    } else if (name === 'pos' && inSense && currentSense) {
      if (value) currentSense.pos.push(stripEntityIfLiteral(value));
    } else if (name === 'gloss' && inSense && currentSense) {
      if (value) currentSense.glosses.push(value);
    } else if (name === 'ex_text' && inExample && currentExample) {
      if (value) currentExample.japanese = value;
    } else if (name === 'ex_sent' && inExample && currentExample) {
      if (value) currentExample.translations.push(value);
    } else if (name === 'example' && currentSense && currentExample) {
      if (currentExample.japanese) {
        if (!currentSense.examples) currentSense.examples = [];
        currentSense.examples.push(currentExample);
      }
      currentExample = null;
      inExample = false;
    } else if (name === 'k_ele') {
      inKEle = false;
    } else if (name === 'r_ele') {
      inREle = false;
    } else if (name === 'sense') {
      if (currentSense) currentEntry.senses.push(currentSense);
      currentSense = null;
      inSense = false;
    }
  };

  parser.onerror = () => {
    // Lax mode recovers from many issues. Clear and resume so a single
    // malformed token doesn't kill the whole import.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parser as any).error = null;
    parser.resume();
  };

  return wrapper;
}

// ----- bulk insert ----------------------------------------------------------

/**
 * SQL-quote a string literal: wrap in single quotes and double any embedded
 * single quotes. JSON content (definitions like "don't") routinely contains
 * apostrophes, so this escape is load-bearing — get it wrong and inserts
 * fail or worse, smuggle SQL.
 *
 * Newlines and other control chars are SQL-safe inside single-quoted
 * string literals; SQLite doesn't interpret backslash escapes by default.
 */
function sqlString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Bulk-insert one batch as a SINGLE multi-statement SQL string passed to
 * Capacitor SQLite's `execute()`. This is the critical perf path on iOS:
 * `executeTransaction(arrayOfStatements)` does one bridge round-trip per
 * statement (so ~2000 round-trips per batch), but `execute(oneBigString)`
 * is a single bridge round-trip — typically 30-50× faster on iPhone.
 *
 * The batch is wrapped in BEGIN/COMMIT inside the SQL string so all
 * inserts apply atomically. We chunk multi-row VALUES at MAX_VALUES_PER_INSERT
 * to stay under SQLite's compound-statement limits.
 */
const MAX_VALUES_PER_INSERT = 500;

async function bulkInsert(entries: JmdictEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const parts: string[] = ['BEGIN;'];

  // jmdict_entries — chunk at MAX_VALUES_PER_INSERT (entries should fit
  // in one chunk at BATCH_SIZE=500, but be defensive).
  for (let i = 0; i < entries.length; i += MAX_VALUES_PER_INSERT) {
    const chunk = entries.slice(i, i + MAX_VALUES_PER_INSERT);
    const values = chunk
      .map(
        (e) =>
          `(${e.entSeq}, ${sqlString(JSON.stringify(e))})`,
      )
      .join(',');
    parts.push(
      `INSERT INTO jmdict_entries (ent_seq, data_json) VALUES ${values}
        ON CONFLICT(ent_seq) DO UPDATE SET data_json = excluded.data_json;`,
    );
  }

  // jmdict_index — collect all (key, ent_seq, is_reading) tuples then chunk.
  const indexRows: string[] = [];
  for (const e of entries) {
    for (const k of e.kanji) {
      indexRows.push(`(${sqlString(k)}, ${e.entSeq}, 0)`);
    }
    for (const r of e.readings) {
      indexRows.push(`(${sqlString(r)}, ${e.entSeq}, 1)`);
    }
  }
  for (let i = 0; i < indexRows.length; i += MAX_VALUES_PER_INSERT) {
    const chunk = indexRows.slice(i, i + MAX_VALUES_PER_INSERT);
    parts.push(
      `INSERT INTO jmdict_index (key, ent_seq, is_reading) VALUES ${chunk.join(',')};`,
    );
  }

  parts.push('COMMIT;');

  const sql = parts.join('\n');
  const conn = await db();
  // `transaction: false` — we manage our own BEGIN/COMMIT so the plugin
  // doesn't double-wrap (which would mean two extra bridge round-trips).
  await conn.execute(sql, /* transaction */ false);
}

async function countEntries(): Promise<number> {
  const rows = await query<{ c: number }>(
    'SELECT COUNT(*) AS c FROM jmdict_entries',
  );
  return rows[0]?.c ?? 0;
}

// ----- helpers --------------------------------------------------------------

const TEXT_DECODER = new TextDecoder('utf-8');
function utf8Decode(buf: Uint8Array): string {
  return TEXT_DECODER.decode(buf, { stream: true });
}
