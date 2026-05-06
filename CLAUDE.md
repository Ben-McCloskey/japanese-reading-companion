# CLAUDE.md

Guidance for working in this codebase. Read this first before making changes.

## What this is

A local-only Electron desktop app for reading Japanese with furigana and an
FSRS-backed flashcard deck built from the user's actual reading. The user is
fluent in spoken Japanese but weak at kanji recognition — every UX decision
optimizes for **fast daily use** over feature breadth.

The full feature surface is described in [`BUILD_SPEC.md`](BUILD_SPEC.md). The
distribution / auto-update workflow is in [`RELEASING.md`](RELEASING.md).

## Frontend Design

When creating, editing, or changing anything on the frontend, ALWAYS invoke the
**`frontend-design`** skill and the **`emil-design-eng`** skill before writing
UI code. The whole visual language depends on the principles in those skills
(restrained editorial palette, ink/cinnabar/sumi tonality, custom easings,
specific transition properties, hover discipline).

## Architecture

Electron app with three processes — keep them clearly separated:

- **`src/main/`** — Electron main. Owns SQLite (`better-sqlite3` only works
  here), filesystem, JMdict download/parse, kuromoji warmup, FSRS scheduling,
  auto-updater. No React, no DOM.
- **`src/preload/`** — Preload script. Exposes a typed `window.api` to the
  renderer via `contextBridge`. The **only** bridge between processes.
- **`src/renderer/`** — React UI. No direct database or filesystem access.
  Talks to main only via `window.api`.
- **`src/shared/`** — Types and IPC channel constants used by both sides
  (`Word`, `SrsState`, `DeckEntry`, channel constants, etc.).

**IPC rule**: every channel constant lives in `src/shared/ipc.ts`, every
handler is registered in `src/main/ipc/register.ts`, every method is exposed
through `src/preload/index.ts`, and the renderer calls `window.api.*`. Never
use `ipcRenderer` directly in components.

**Context isolation must stay enabled.** Never disable `contextIsolation`,
never enable `nodeIntegration`, keep `sandbox: true`.

## Layout overview

```
src/
  main/
    index.ts                       Electron entry, wires everything
    db/
      connection.ts                better-sqlite3 + WAL pragmas
      migrations/                  Numbered .sql + ?raw imports
      repos/                       Prepared-statement repos (one per table family)
    services/
      dictionary/                  JMdict downloader + sax parser + importer + lookup
      tokenizer/                   kuromoji wrapper
      deck/                        Add/remove/state orchestration
      review/                      Queue + transactional submit
      srs/                         ts-fsrs wrapper (+ vitest unit tests)
      appearances/                 word_session_appearances bookkeeping
      auto-updater/                electron-updater wrapping
    ipc/
      register.ts                  Maps IPC channels to deps
      events.ts                    Broadcast helper for webContents.send
  preload/
    index.ts                       contextBridge.exposeInMainWorld('api', ...)
    api.d.ts                       Window.api type augmentation
  renderer/
    main.tsx, app.tsx              React root + route gate
    components/                    Reusable UI (sidebar, word-panel, reading-text, ...)
    pages/                         One file per top-level route
    lib/                           Hooks + small helpers (cn, kana, grammar, srs-style, tts, ...)
    styles/globals.css             Tailwind + design tokens + .panel-enter / .fade-rise
  shared/
    ipc.ts, api.ts                 Channel constants + Api interface
    result.ts                      Result<T> = Ok | Err
    types/                         jmdict, tokenizer, deck, sessions
build/icon.svg, build/icon.png     Hanko-stamp app icon
electron-builder.yml               Mac DMG + ZIP, GitHub publish target
RELEASING.md                       Release workflow (private repo + GH_TOKEN)
```

## Commands

```bash
npm run dev          # start dev with hot reload (env -u ELECTRON_RUN_AS_NODE)
npm run build        # production build (electron-vite)
npm run package      # build + electron-builder (DMG + ZIP, no publish)
npm run release      # build + electron-builder --publish always (uploads draft to GitHub)
npm run typecheck    # strict tsc --noEmit across main + renderer
npm run lint         # eslint
npm run test         # vitest run
npm run db:reset     # delete the SQLite file (keeps JMdict cache)
```

If you add a script, document it here.

## Environment quirks (non-obvious, will save you 30 min)

- **`ELECTRON_RUN_AS_NODE=1`** is set in the user's shell. It forces Electron
  to behave as plain Node and breaks `require('electron')`. The `dev`,
  `package`, and `release` scripts all `env -u` it locally — never remove
  those `env -u` prefixes.
- **DMG packaging requires `PYTHON_PATH=/opt/homebrew/bin/python3.12`** because
  `dmg-builder` shells out to a Python script and the user's pyenv Python is
  3.7.9 (missing `_ctypes`). Already baked into the `package`/`release`
  scripts.
- **`GH_TOKEN`** must be set for `npm run release` (uploads to private GitHub
  repo). Stored in user's `~/.zshrc`. See `RELEASING.md`.
- **macOS Japanese TTS voices** are hidden behind System Settings →
  Accessibility → Spoken Content → Manage Voices. Default Kyoko/Otoya are
  robotic; Premium variants are a free download and noticeably better.

## Code conventions

- **TypeScript strict mode is on**, plus `noUncheckedIndexedAccess`. No `any`
  without a `// eslint-disable` comment explaining why.
- **No default exports** except for React components and Electron entry points.
- **Files use kebab-case**, components use PascalCase: `word-panel.tsx`
  exports `WordPanel`.
- **Keep components small** (~150 lines max). Split when they grow.
- **Business logic lives outside components.** FSRS, tokenization, dictionary
  lookups, appearance tallying — all in plain TS modules under
  `src/main/services/` and `src/renderer/lib/`. Hooks wrap state, components
  render.
- **Errors are never silently swallowed.** Every IPC handler wraps in
  try/catch and returns `Result<T>` (`{ ok: true, data } | { ok: false, error }`).
  Renderer surfaces via toasts or inline error blocks.
- **Animations**: specify exact properties (`transition-[background-color]`,
  not `transition-colors`). Custom easings only (`ease-out-strong` =
  `cubic-bezier(0.23, 1, 0.32, 1)`). Hover transitions stay under 150ms with
  `ease`. Press feedback is `active:scale-[0.97]` on every pressable element.

## Database

- SQLite at `app.getPath('userData')/jrc.sqlite`, WAL mode, foreign keys ON.
- Schema is applied via numbered `.sql` files in `src/main/db/migrations/`,
  imported as `?raw` strings, tracked in a `_migrations` table. **Never edit a
  shipped migration** — add a new one.
- Currently shipped migrations:
  - `0001_init.sql` — settings table + bookkeeping
  - `0002_app_tables.sql` — sessions, words, srs_state, reviews, jmdict cache,
    jlpt_levels
  - `0003_appearances.sql` — `word_session_appearances` for "times seen"
- All DB access goes through repos in `src/main/db/repos/`. Use prepared
  statements; no string-interpolated SQL ever. Multi-statement writes wrap in
  `db.transaction(...)`.

## Japanese-specific gotchas

- **Always tokenize on the dictionary form** when adding to the deck.
  Kuromoji's `basic_form` is the right field — `食べました` → store `食べる`.
- **Ruby tags only over kanji-containing tokens**. Pure kana renders as plain
  text. `hasKanji()` lives in `src/renderer/lib/kana.ts`.
- **Furigana hides until hover** by default — `<rt>` opacity is 0 unless the
  containing `[role="button"]` is hovered/focused/`aria-pressed="true"`.
  This is the user's preferred reading mode (recall first, hint on demand).
- **Kuromoji has a 1–2s warmup** on first tokenization. Pre-warm on app start
  in main, broadcast `tokenizer:ready` event, show a subtle loading state.
- **JMdict is large** (~80 MB XML, ~13 MB gzipped). Streamed download +
  decompress + sax parse, batched 500-row transactions. Cached XML at
  `userData/cache/JMdict_e.xml` survives parse failures so retries are
  parse-only. The standard `JMdict_e.gz` from edrdg does not include
  `<example>` elements — definitions populate, examples often don't.
- **JMdict entity handling**: the DTD declares ~100 named entities for POS
  (`&n;`, `&v5k;`, etc.). sax-js doesn't auto-resolve them, so we extract
  entity declarations from the `ondoctype` event and re-bind each entity to
  its short tag. As a fallback, `stripEntityIfLiteral` cleans up any `&xxx;`
  that slips into text content.
- **Furigana font sizing**: `0.5em` relative to the base text, `ruby-position:
  over`, `ruby-align: center`. Lives in `globals.css` `.ruby-base rt`.
- **Particles, aux verbs, punctuation** are filtered out of "lookup-able"
  tokens via `isLookupSkippable()` in `src/renderer/lib/grammar.ts`. They
  render as plain text in the reading view (slightly dimmed) and can't be
  added to the deck.
- **JLPT levels** are a separate dataset (JMdict has no JLPT field). The
  `jlpt_levels` table is populated from `src/main/data/jlpt-levels.json`
  (bundled, currently empty seed) or from a user override at
  `userData/jlpt-levels.json`. The Settings page surfaces this.

## FSRS

- Uses **`ts-fsrs`** with **default parameters**. Do not invent your own
  scheduling algorithm.
- Wrapper is `src/main/services/srs/fsrs.ts`. Conversion is bidirectional:
  `rowToCard(SrsRow)` → FSRS `Card`, then back to row patch. Unit tests in
  `src/main/services/srs/fsrs.test.ts`.
- The four ratings are `Again` (1), `Hard` (2), `Good` (3), `Easy` (4) —
  match this exactly across the UI and the DB.
- Persist the full FSRS state per word: `stability`, `difficulty`, `due_date`
  (ISO timestamp), `review_count`, `lapse_count`, `last_reviewed_at`. Never
  derive these from review history.
- After every review, run a single transaction:
  `srs.applyPatchSync(...)` + `reviews.log(...)`. Both succeed or both fail.
  The transaction lives in `src/main/services/review/index.ts`.
- **`'known'` is outside FSRS**. Words flagged Known have `due_date =
  '9999-12-31'` and never enter the queue.
- **Newly-added words have a 4-hour first-review delay** (see `markNew()`).
  This avoids the "look up + review 30 seconds later" anti-pattern.

## Daily review cap + persistence

- Cap is stored in setting `dailyReviewCap` (default 20, `0` = unlimited).
- Today's done count persists across launches in two settings:
  `reviewsDoneDate` (YYYY-MM-DD local time) + `reviewsDoneCount`. Resets at
  local midnight (compared to `todayLocalDate()` in
  `src/renderer/lib/daily-review.ts`).
- Queue is truncated client-side to `cap - persistedDone`.

## Performance expectations

- Tokenizing 500 chars: <100 ms after warmup.
- Lookup panel after click: <50 ms (single indexed SQLite query through
  `jmdict_index`).
- Reading view should handle pasted text up to ~5 000 characters without lag.

If you add something that might slow these down, measure it.

## Testing

- Unit tests for: FSRS wrapper. Add tests for tokenization helpers,
  conjugation analysis, sentence extraction if you change them.
- No need for full E2E or React component tests unless something breaks
  repeatedly.
- Test data lives next to code (`*.test.ts`). vitest config:
  `vitest.config.ts` with the same `@shared` / `@main` / `@renderer` aliases
  as the runtime build.

## Distribution & updates

- App ships as a macOS DMG (and ZIP) via `npm run release`. Uploads as a
  **draft** to private GitHub repo
  `Ben-McCloskey/japanese-reading-companion`. Drafts must be manually
  published on github.com to actually go live.
- Auto-updater (`electron-updater`) polls the same repo every 30 minutes,
  downloads new versions in the background, surfaces a cinnabar
  "update ready" button in the sidebar footer. One click → `quitAndInstall`.
- Token (`GH_TOKEN`) is baked into `app-update.yml` inside the bundle at
  build time so the installed copy can read the private repo. Acceptable for
  personal use; rotate the PAT if leaked. See `RELEASING.md`.

## What NOT to do

- ❌ No cloud services, no API calls to external servers (except JMdict
  download on first run and GitHub Releases for updates).
- ❌ No analytics, telemetry, crash reporting.
- ❌ No login system or user accounts. Single-user app.
- ❌ No "AI-powered" definitions via LLM calls. JMdict is the source of truth.
- ❌ No heavyweight UI libraries (no MUI, Chakra, Ant Design). Tailwind +
  shadcn-style copy-in components only.
- ❌ No state management library (Redux, Zustand) until proven necessary.
  React state + small module-level pub-sub (see `tts.ts`) is sufficient.
- ❌ Don't add dependencies casually. If a 5-line utility solves it, write
  the 5 lines.
- ❌ Never run destructive git commands (`reset --hard`, `push --force`,
  `branch -D`) without explicit user request.

## Working style

- The original 7-phase plan is **complete**. New work is incremental polish
  or bug-fixing. Surface a brief "here's what I'll change" before writing
  code if the change touches multiple files.
- When unsure between two approaches, ask before implementing — don't pick
  silently.
- When a task feels larger than expected, surface it early rather than
  disappearing into a long autonomous session.
- Keep this file updated. Discovered a non-obvious gotcha while working? Add
  it to the relevant section here.
