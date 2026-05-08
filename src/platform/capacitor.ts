// Capacitor build entry. The Vite alias `@platform` resolves directly to
// this file, so the renderer's `import { api } from '@platform'` lands here
// (not in index.ts, which is the Electron entry).
//
// The actual SQLite-backed Api implementation lives in capacitor-api.ts. We
// re-export it from here so the alias surface stays simple.

export { capacitorApi as api } from './capacitor-api';

export const PLATFORM = 'capacitor' as const;
