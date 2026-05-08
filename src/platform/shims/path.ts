// Tiny `path` shim for the Capacitor web build. Kuromoji's DictionaryLoader
// uses `path.join(dicPath, filename)` to build dict file URLs. Node-only
// `path` doesn't exist in WKWebView, so Vite would externalize it and the
// runtime would crash with "path.join is not a function".
//
// We only need `join` for URL-like concatenation. Anything else throws so
// any future stray dependency is loud.

function join(...parts: string[]): string {
  const cleaned = parts
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((p, i) =>
      i === 0
        ? p.replace(/\/+$/, '')
        : p.replace(/^\/+/, '').replace(/\/+$/, ''),
    )
    .filter((p) => p.length > 0);
  return cleaned.join('/');
}

const stub: Record<string, unknown> = {
  join,
};

export default stub;
export { join };
