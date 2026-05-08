import { IcloudSync } from './icloud-plugin';

/**
 * iOS-side counterpart of src/main/services/sync/icloud-driver.ts. Mirrors
 * the same surface (ensureFolder / appendLines / readFile / listFiles /
 * watch) so the engine code is structurally identical on both platforms.
 *
 * Capacitor's Filesystem plugin doesn't reach the iCloud container, so all
 * operations go through our Swift plugin (IcloudSyncPlugin).
 */
export interface CapacitorSyncDriver {
  /** Resolved iCloud sync directory path; populated after first ensureFolder. */
  resolvedPath(): string | null;
  ensureFolder(): Promise<void>;
  appendLines(filename: string, lines: string[]): Promise<void>;
  readFile(filename: string): Promise<string | null>;
  listFiles(): Promise<string[]>;
  /** Polling-only on iOS — no native fs.watch equivalent here. */
  watch(cb: () => void, intervalMs: number): () => void;
}

export function createCapacitorIcloudDriver(): CapacitorSyncDriver {
  let path: string | null = null;

  async function ensureFolder(): Promise<void> {
    await IcloudSync.ensureFolder();
    if (!path) {
      const res = await IcloudSync.containerPath();
      path = res.path;
    }
  }

  return {
    resolvedPath: () => path,

    ensureFolder,

    async appendLines(filename, lines) {
      if (lines.length === 0) return;
      await IcloudSync.appendFile({
        filename,
        content: lines.join('\n') + '\n',
      });
    },

    async readFile(filename) {
      const res = await IcloudSync.readFile({ filename });
      return res.content;
    },

    async listFiles() {
      const res = await IcloudSync.listFiles();
      return res.files;
    },

    watch(cb, intervalMs) {
      // Capacitor doesn't expose fs.watch; iCloud changes propagate at
      // their own pace anyway, so polling at the engine's pull interval
      // is sufficient.
      const handle = setInterval(cb, intervalMs);
      return () => clearInterval(handle);
    },
  };
}
