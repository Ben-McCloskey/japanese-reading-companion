import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import type { JmdictRepo } from '@main/db/repos/jmdict-repo';
import type { JmdictEntry } from '@shared/types/jmdict';
import { downloadAndDecompressJmdict } from './downloader';
import { parseJmdictStream } from './jmdict-parser';
import type { DictImportPhase, DictStatus } from '@shared/ipc';

const BATCH_SIZE = 500;
const PROGRESS_EVERY = 100;

export interface ImporterDeps {
  repo: JmdictRepo;
  onStatus: (status: DictStatus) => void;
}

export async function importJmdict(deps: ImporterDeps): Promise<void> {
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const xmlPath = path.join(cacheDir, 'JMdict_e.xml');

  const setPhase = (phase: DictImportPhase, extra?: Partial<Extract<DictStatus, { kind: 'importing' }>>) => {
    deps.onStatus({ kind: 'importing', phase, ...extra });
  };

  try {
    console.log('[jmdict-import] starting');

    // Re-use a previous decompressed XML if it survived a failed run.
    let cachedSize = 0;
    try {
      cachedSize = fs.statSync(xmlPath).size;
    } catch {
      cachedSize = 0;
    }

    if (cachedSize > 50 * 1024 * 1024) {
      console.log(
        `[jmdict-import] reusing cached XML at ${xmlPath} (${(cachedSize / 1024 / 1024).toFixed(1)} MB)`,
      );
    } else {
      setPhase('downloading');
      await downloadAndDecompressJmdict({
        destPath: xmlPath,
        onProgress: ({ received, total }) => {
          setPhase('downloading', {
            received,
            ...(total != null ? { total } : {}),
          });
        },
      });
      const stat = fs.statSync(xmlPath);
      console.log(
        `[jmdict-import] download complete, decompressed XML is ${(stat.size / 1024 / 1024).toFixed(1)} MB`,
      );
    }

    setPhase('parsing', { entries: 0 });

    deps.repo.clear();

    let buffer: JmdictEntry[] = [];
    let totalEntries = 0;
    let lastReported = 0;

    await parseJmdictStream({
      filePath: xmlPath,
      progressEvery: PROGRESS_EVERY,
      onEntry: (entry) => {
        buffer.push(entry);
        if (buffer.length >= BATCH_SIZE) {
          deps.repo.bulkInsert(buffer);
          totalEntries += buffer.length;
          buffer = [];
        }
      },
      onProgress: (count) => {
        // Use the parser's running count so we report progress regardless of
        // when the SQLite batch flushes.
        if (count - lastReported >= PROGRESS_EVERY) {
          lastReported = count;
          setPhase('parsing', { entries: count });
        }
      },
    });

    if (buffer.length > 0) {
      deps.repo.bulkInsert(buffer);
      totalEntries += buffer.length;
      buffer = [];
    }

    console.log(`[jmdict-import] total ${totalEntries} entries inserted`);
    setPhase('finalizing', { entries: totalEntries });

    // Best-effort cleanup of the cached XML file. Re-download next time.
    try {
      fs.unlinkSync(xmlPath);
    } catch {
      // ignore
    }

    deps.onStatus({ kind: 'ready', entryCount: deps.repo.entryCount() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.onStatus({ kind: 'failed', error: message });
    throw e;
  }
}
