/// <reference types="vite/client" />
import type { Api } from '@shared/api';

declare global {
  interface Window {
    api: Api;
  }

  /** Injected at build time from package.json by Vite `define`. */
  const __APP_VERSION__: string;
}

export {};
