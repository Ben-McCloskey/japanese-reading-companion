/// <reference types="vite/client" />

declare module '*.sql?raw' {
  const content: string;
  export default content;
}

/** Injected at build time by Vite `define`. Empty string when unset. */
declare const __GH_TOKEN__: string;
