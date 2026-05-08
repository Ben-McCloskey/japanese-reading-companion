// Platform-aware api selector. The Electron build resolves `@platform` here
// (and we re-export from electron.ts). The Capacitor build aliases
// `@platform` directly at capacitor.ts, bypassing this file — so neither
// build pulls the other's dependencies.
export { api } from './electron';
export type { Api, Unsubscribe } from './api';

export const PLATFORM = 'electron' as const;
