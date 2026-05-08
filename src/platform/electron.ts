import type { Api } from '@shared/api';

// Electron implementation: the preload script exposes window.api via
// contextBridge. This module is a thin pointer so renderer code imports a
// stable @platform path regardless of host environment.
export const api: Api = window.api;
