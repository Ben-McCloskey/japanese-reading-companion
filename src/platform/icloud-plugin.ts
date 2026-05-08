import { registerPlugin } from '@capacitor/core';

/**
 * TS bridge to the native Swift IcloudSyncPlugin (ios/App/App/IcloudSyncPlugin.swift).
 *
 * Capacitor auto-registers Swift classes that conform to CAPBridgedPlugin
 * via Objective-C runtime reflection, so simply calling registerPlugin
 * here (with the same `jsName` the Swift class declares) wires them up.
 */
export interface IcloudSyncPlugin {
  /** Returns the absolute filesystem path of the iCloud sync directory. */
  containerPath(): Promise<{ path: string }>;
  /** Creates the sync directory if it doesn't exist. No-op otherwise. */
  ensureFolder(): Promise<void>;
  /** Reads a file by name. Returns `{ content: null }` if missing. */
  readFile(opts: { filename: string }): Promise<{ content: string | null }>;
  /** Appends UTF-8 content to a file (creates if missing). */
  appendFile(opts: { filename: string; content: string }): Promise<void>;
  /** Lists filenames in the sync directory. */
  listFiles(): Promise<{ files: string[] }>;
}

export const IcloudSync = registerPlugin<IcloudSyncPlugin>('IcloudSync');
