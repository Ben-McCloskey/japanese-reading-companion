import { promises as fsp, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

/**
 * File-system abstraction for the sync log directory. The Electron build
 * uses Node fs against an iCloud-Drive-mirrored path; the Capacitor build
 * (Phase 2+) will swap in a `@capacitor/filesystem` implementation against
 * its iCloud container.
 */
export interface SyncDriver {
  readonly resolvedPath: string;
  ensureFolder(): Promise<void>;
  appendLines(filename: string, lines: string[]): Promise<void>;
  readFile(filename: string): Promise<string | null>;
  listFiles(): Promise<string[]>;
  watch(cb: () => void): () => void;
}

const APP_FOLDER = 'JapaneseReadingCompanion';
const ICLOUD_CONTAINER_DIR =
  // Phase 3 plants this path when the iOS app declares its iCloud container.
  // macOS mirrors it locally for non-sandboxed access.
  'iCloud~com~benmccloskey~JapaneseReadingCompanion';

/**
 * Path to the iOS app's iCloud container as macOS would mirror it locally.
 * Only exists once the iOS app has been installed and run; preferred over
 * the general iCloud Drive root because Apple guarantees Files.app shows it
 * and the sandbox boundary is tighter.
 */
export function iosContainerSyncFolder(): string {
  return path.join(
    os.homedir(),
    'Library',
    'Mobile Documents',
    ICLOUD_CONTAINER_DIR,
    'Documents',
    'sync',
  );
}

/**
 * Default sync folder when the user hasn't picked one explicitly.
 *
 *  - macOS → general iCloud Drive root: `~/Library/Mobile Documents/
 *    com~apple~CloudDocs/JapaneseReadingCompanion/sync/`. iCloud handles
 *    upload/download from there.
 *  - Other platforms → app's userData/sync (no real sync, but the engine
 *    still works for testing on Linux/Windows dev machines).
 *
 * The user can override via Settings → Sync.
 */
export function defaultSyncFolder(): string {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      APP_FOLDER,
      'sync',
    );
  }
  return path.join(app.getPath('userData'), 'sync');
}

export function createSyncDriver(folderPath: string): SyncDriver {
  return {
    resolvedPath: folderPath,

    async ensureFolder() {
      await fsp.mkdir(folderPath, { recursive: true });
    },

    async appendLines(filename, lines) {
      if (lines.length === 0) return;
      const filepath = path.join(folderPath, filename);
      // Single appendFile call — POSIX appends are atomic for write sizes
      // under PIPE_BUF, which matters when iCloud syncs mid-write. For the
      // sake of larger payloads, we still trust appendFile to be near-atomic
      // on macOS local disks; iCloud uploads the file as it sees it.
      await fsp.appendFile(filepath, lines.join('\n') + '\n', 'utf8');
    },

    async readFile(filename) {
      const filepath = path.join(folderPath, filename);
      try {
        return await fsp.readFile(filepath, 'utf8');
      } catch (e) {
        if (
          e instanceof Error &&
          (e as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          return null;
        }
        throw e;
      }
    },

    async listFiles() {
      try {
        return await fsp.readdir(folderPath);
      } catch (e) {
        if (
          e instanceof Error &&
          (e as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          return [];
        }
        throw e;
      }
    },

    watch(cb) {
      try {
        const watcher = fsWatch(
          folderPath,
          { persistent: false },
          () => cb(),
        );
        return () => watcher.close();
      } catch {
        // fs.watch can throw if the folder doesn't exist yet, or on certain
        // network filesystems. Falling back to interval polling alone is
        // fine — return a no-op unsubscriber.
        return () => {
          /* no-op */
        };
      }
    },
  };
}
