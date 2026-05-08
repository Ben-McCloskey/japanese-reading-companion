// Replaces kuromoji's BrowserDictionaryLoader.loadArrayBuffer (XHR + zlibjs)
// with a fetch + native DecompressionStream implementation.
//
// Why we need this:
//   1. XHR over Capacitor's `capacitor://localhost` scheme has been
//      observed to hang silently rather than fail with a status code,
//      which leaves kuromoji's builder waiting on a callback that never
//      fires — symptom: "Warming kuromoji…" forever.
//   2. fetch() reports HTTP-style errors as Promise rejections, which
//      lets us bubble them up through the existing TokenizerStatus
//      'failed' path so the user actually sees what went wrong.
//   3. iOS WKWebView 16.4+ ships DecompressionStream — we can drop
//      zlibjs from the hot path entirely.
//
// We monkey-patch the prototype before any tokenizer is built. The
// patch is idempotent: importing this module multiple times is fine.

// Deep import into kuromoji's internals so we can swap loadArrayBuffer on
// the prototype. The package has no `exports` field, so this is permitted;
// it's been stable across kuromoji versions for years. The TS shim below
// captures only the prototype shape we touch.
//
// @ts-expect-error — no declaration file for this internal path.
import BrowserDictionaryLoaderModule from 'kuromoji/src/loader/BrowserDictionaryLoader.js';

const BrowserDictionaryLoader = BrowserDictionaryLoaderModule as {
  prototype: {
    loadArrayBuffer(
      url: string,
      cb: (err: unknown, buffer?: ArrayBuffer) => void,
    ): void;
  };
};

export interface LoaderProgress {
  /** Files successfully loaded (relative URLs). */
  loaded: string[];
  /** Currently in-flight URL, if any. */
  current: string | null;
  /** First failure encountered, if any. */
  error: string | null;
}

const state: LoaderProgress = { loaded: [], current: null, error: null };
const listeners = new Set<(p: LoaderProgress) => void>();

function snapshot(): LoaderProgress {
  return { loaded: [...state.loaded], current: state.current, error: state.error };
}
function notify(): void {
  const snap = snapshot();
  for (const cb of listeners) cb(snap);
}

export function onKuromojiProgress(cb: (p: LoaderProgress) => void): () => void {
  listeners.add(cb);
  // Fire current state immediately so subscribers don't miss past events.
  queueMicrotask(() => cb(snapshot()));
  return () => {
    listeners.delete(cb);
  };
}

export function getKuromojiProgress(): LoaderProgress {
  return snapshot();
}

let patched = false;

export function installKuromojiLoaderPatch(): void {
  if (patched) return;
  patched = true;

  BrowserDictionaryLoader.prototype.loadArrayBuffer = function loadArrayBuffer(
    url: string,
    cb: (err: unknown, buffer?: ArrayBuffer) => void,
  ): void {
    state.current = url;
    notify();

    void (async () => {
      // 30s per file is generous — uncompressed dict files are <8 MB on
      // local bundle, network is irrelevant.
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        }
        const compressed = await res.arrayBuffer();
        const decompressed = await gunzip(compressed);
        state.loaded.push(url);
        state.current = null;
        notify();
        cb(null, decompressed);
      } catch (e) {
        const msg =
          e instanceof DOMException && e.name === 'AbortError'
            ? `Timeout fetching ${url}`
            : e instanceof Error
              ? e.message
              : String(e);
        if (!state.error) state.error = msg;
        state.current = null;
        notify();
        cb(e instanceof Error ? e : new Error(msg));
      } finally {
        clearTimeout(timeout);
      }
    })();
  };
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  // DecompressionStream is in WKWebView from iOS 16.4 onward, which is the
  // floor we need for Web Inspector / Capacitor 6 anyway. If it's missing
  // we surface a clear error rather than dragging zlibjs into the hot path.
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'DecompressionStream unavailable — this app needs iOS 16.4 or newer.',
    );
  }
  const stream = new Response(buf).body;
  if (!stream) throw new Error('Response.body unavailable');
  const decoded = stream.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(decoded).arrayBuffer();
}
