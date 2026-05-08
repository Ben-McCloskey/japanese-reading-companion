// Re-export of the shared Api contract. Platform implementations live in
// sibling files (electron.ts, capacitor.ts) and select via index.ts.
export type { Api, Unsubscribe } from '@shared/api';
