# Japanese Reading Companion

A local-only desktop reader for Japanese text. Paste a message, see it with furigana, click any word for its meaning, and quietly build an FSRS-scheduled flashcard deck from your real reading.

> Status: **Phase 1** — Electron + React + TypeScript skeleton with a working SQLite + IPC bridge. Japanese-language features (tokenizer, dictionary, furigana, flashcards) land in subsequent phases.

## Setup

```bash
npm install
npm run dev          # launch Electron with hot reload
npm run typecheck    # strict TypeScript check across main + renderer
npm run build        # production build into out/
npm run package      # platform installer (DMG / NSIS / AppImage)
npm run db:reset     # delete the local SQLite database
```

## Architecture

Three Electron processes, hard-separated:

- **`src/main/`** — Electron main. Owns SQLite (via `better-sqlite3`), the filesystem, and JMdict parsing (later phases). No DOM, no React.
- **`src/preload/`** — Preload script. Bridges main and renderer via `contextBridge` and exposes a typed `window.api`.
- **`src/renderer/`** — React UI. Talks to main only through `window.api`.
- **`src/shared/`** — Types and IPC channel constants used by both sides.

`contextIsolation` is on, `nodeIntegration` is off, `sandbox` is on. Don't change that.

## Database

SQLite lives at `app.getPath('userData')/jrc.sqlite`. Schema is applied via numbered SQL files in `src/main/db/migrations/`, tracked in a `_migrations` table. Never edit a shipped migration — add a new one.

## JMdict (later)

Phase 2 will fetch JMdict from edrdg.org on first run, parse it once, cache the parsed copy in `userData`, and never re-parse.

## Phase 1 acceptance test

1. `npm install && npm run dev` opens the window.
2. Sidebar nav switches between Read / Review / Sessions / Words / Settings placeholders.
3. Toggle dark mode in Settings; close the window; reopen → theme persists. (Proves IPC + SQLite write/read round-trip.)
4. `npm run typecheck` is green.
5. `npm run db:reset` removes the SQLite file. Relaunch recreates it and re-runs migration `0001_init.sql`.
