# CLAUDE.md

Guidance for working in this codebase. Read this first before making changes.

## What this is

A reading + flashcard app for Japanese, shipped as a native macOS Electron
app **and** a sideloaded iOS Capacitor app. The two devices stay in sync
via the user's own iCloud Drive — no servers, no accounts.

The user is fluent in spoken Japanese but weak at kanji recognition. Every
UX decision optimizes for **fast daily use** over feature breadth.

- Full feature surface: [`BUILD_SPEC.md`](BUILD_SPEC.md)
- Mac release/auto-update: [`RELEASING.md`](RELEASING.md)
- iOS today is sideload-only via Xcode (`npm run ios:sync && npm run ios:open`).

## Frontend Design

When creating, editing, or changing anything on the frontend, ALWAYS invoke the
**`frontend-design`** skill and the **`emil-design-eng`** skill before writing
UI code. The whole visual language depends on the principles in those skills
(restrained editorial palette, ink/cinnabar/sumi tonality, custom easings,
specific transition properties, hover discipline).

## Architecture

The renderer is the same React/TypeScript code on both platforms. What
changes underneath is the platform implementation of one shared `Api`
interface.

### Mac (Electron)

Three processes — keep them clearly separated:

- **`src/main/`** — Electron main. Owns SQLite (`better-sqlite3` only works
  here), filesystem, JMdict download/parse, kuromoji warmup, FSRS scheduling,
  auto-updater, sync engine + iCloud driver. No React, no DOM.
- **`src/preload/`** — Preload script. Exposes a typed `window.api` to the
  renderer via `contextBridge`. The **only** bridge between processes.
- **`src/renderer/`** — React UI. No direct database or filesystem access.
  Talks to main only via `window.api`.
- **`src/shared/`** — Types and IPC channel constants used by both sides.

**IPC rule** (Mac): every channel constant lives in `src/shared/ipc.ts`,
every handler is registered in `src/main/ipc/register.ts`, every method is
exposed through `src/preload/index.ts`, and the renderer calls
`window.api.*`. Never use `ipcRenderer` directly in components.

**Context isolation must stay enabled.** Never disable `contextIsolation`,
never enable `nodeIntegration`, keep `sandbox: true`.

### iOS (Capacitor)

Two layers — single WKWebView, no separate main process:

- **`src/platform/capacitor-*.ts`** — TypeScript implementation of the
  same `Api` interface that lives directly inside the renderer's webview.
  No IPC bridge; just direct calls into Capacitor SQLite, the iCloud
  plugin, etc.
- **`ios/App/App/IcloudSyncPlugin.swift`** — small Swift plugin for the
  iCloud Documents container, since Capacitor Filesystem can't reach it.
  Registered on the bridge by `MainViewController` (a subclass of
  `CAPBridgeViewController`) — Capacitor 6 only auto-discovers plugins
  shipped via CocoaPods, so app-level plugins need explicit
  `bridge?.registerPluginInstance(...)`.

### Shared platform indirection

- **`src/platform/`** — both implementations of the `Api`. Renderer
  imports from `@platform`, which the build aliases to either
  `src/platform/electron.ts` (Electron build) or
  `src/platform/capacitor.ts` (Capacitor web build). Components NEVER
  reference Electron or Capacitor directly.
- **`src/shared/api.ts`** — the `Api` interface contract; both
  implementations must satisfy it.
- **`src/shared/types/sync.ts`** — sync event kinds + payloads, used by
  both sides of the sync engine.

When you add a new method, update **all four** of: the `Api` interface in
`src/shared/api.ts`, the Electron implementation (IPC channel + main
handler + preload exposure), and the Capacitor implementation in
`src/platform/capacitor-api.ts`. TypeScript will fail the build if you
miss any.

## Layout overview

```
src/
  main/                            Electron main process (Mac only)
    index.ts                       Entry, wires everything
    db/
      connection.ts                better-sqlite3 + WAL pragmas
      migrations/                  Numbered .sql + ?raw imports (shared with iOS)
      repos/                       Prepared-statement repos
    services/
      dictionary/                  JMdict downloader + sax parser + importer
      tokenizer/                   kuromoji warmup wrapper
      deck/                        Add/remove/state orchestration
      review/                      Queue + transactional submit
      srs/                         ts-fsrs wrapper (+ vitest unit tests)
      appearances/                 word_session_appearances bookkeeping
      auto-updater/                electron-updater wrapping
      sync/                        Event log + iCloud driver + engine + replayer
                                   + backfill (Mac-only one-shot command)
    ipc/
      register.ts                  Maps IPC channels to deps
      events.ts                    Broadcast helper for webContents.send
  preload/                         Mac only
    index.ts                       contextBridge.exposeInMainWorld('api', ...)
  platform/                        Cross-platform Api implementations
    api.ts, index.ts               Re-export the right impl
    electron.ts                    Electron path (re-exports window.api)
    capacitor.ts                   Capacitor path (re-exports capacitorApi)
    capacitor-api.ts               iOS implementation of the Api interface
    capacitor-db.ts                Capacitor SQLite open + migrate + helpers
    capacitor-event-log.ts         iOS event-log append/ingest (mirror of main/services/sync)
    capacitor-icloud-driver.ts     iCloud folder reads/writes via the Swift plugin
    capacitor-jmdict.ts            iOS JMdict streaming pipeline (pako + sax)
    capacitor-replayer.ts          Apply remote sync events to iOS SQLite
    capacitor-sync-engine.ts       Push/pull cycle, polling-based watcher
    icloud-plugin.ts               Capacitor plugin client wrapper
    kuromoji-loader.ts             iOS kuromoji warmup
    shims/path.ts                  Tiny `node:path` shim for kuromoji's loader
  renderer/
    main.tsx, app.tsx              React root + route gate (DictStatus gating)
    components/                    Reusable UI (sidebar, bottom-tabs, word-panel, ...)
    pages/                         One file per top-level route
    lib/                           Hooks + helpers (cn, kana, grammar, srs-style, tts, ...)
    styles/globals.css             Tailwind + design tokens + .panel-enter / .fade-rise
  shared/
    ipc.ts                         Electron IPC channel constants + types
    api.ts                         The Api interface (single source of truth)
    result.ts                      Result<T> = Ok | Err
    types/                         jmdict, tokenizer, deck, sessions, sync, srs
ios/
  App/App.xcworkspace              Open this in Xcode (not the .xcodeproj)
  App/App/IcloudSyncPlugin.swift   Swift plugin + MainViewController subclass
  App/App/Info.plist               NSAppTransportSecurity exception for edrdg.org;
                                   NSUbiquitousContainers (iCloud container ID)
  App/App/App.entitlements         iCloud capability + container identifier
  App/App/Base.lproj/Main.storyboard  customClass=MainViewController, module=App
electron-builder.yml               Mac DMG + ZIP, GitHub publish target
capacitor.config.ts                Capacitor config (appId + webDir)
vite.web.config.ts                 iOS web bundle (separate from electron-vite)
```

## Commands

```bash
# Mac
npm run dev          # start dev with hot reload (env -u ELECTRON_RUN_AS_NODE)
npm run build        # production build (electron-vite)
npm run package      # build + electron-builder (DMG + ZIP, no publish)
npm run release      # build + electron-builder --publish always (draft to GitHub)

# iOS
npm run build:web    # build the Capacitor web bundle (vite.web.config.ts → out/web)
npm run ios:sync     # build:web + cap sync ios (copies bundle into ios/App/App/public)
npm run ios:open     # open ios/App/App.xcworkspace in Xcode
                     # then ⌘⇧K (clean) → ⌘R to install on a connected iPhone

# Both
npm run typecheck    # strict tsc --noEmit across both build targets (Node + Web)
npm run lint         # ESLint v9 flat config (eslint.config.mjs) — TS + React
npm run test         # vitest run (FSRS + sync replayer)
npm run db:reset     # delete the Mac SQLite file
```

If you add a script, document it here.

## Environment quirks (non-obvious, will save you 30 min)

### General

- **`ELECTRON_RUN_AS_NODE=1`** is set in the user's shell. It forces Electron
  to behave as plain Node and breaks `require('electron')`. The `dev`,
  `package`, and `release` scripts all `env -u` it locally — never remove
  those `env -u` prefixes.
- **DMG packaging requires `PYTHON_PATH=/opt/homebrew/bin/python3.12`** because
  `dmg-builder` shells out to a Python script and the user's pyenv Python is
  3.7.9 (missing `_ctypes`). Already baked into the `package`/`release`
  scripts.
- **`GH_TOKEN`** must be set for `npm run release` (uploads to the public
  GitHub repo). Stored in user's `~/.zshrc`. The installed app does not
  need the token — it reads from the public repo without auth. See
  `RELEASING.md`.
- **macOS Japanese TTS voices** are hidden behind System Settings →
  Accessibility → Spoken Content → Manage Voices. Default Kyoko/Otoya are
  robotic; Premium variants are a free download and noticeably better.

### Build / release

- **`hdiutil resize` failures** are a known transient macOS issue when
  building the DMG, usually caused by iOS Simulator runtimes mounted in
  the background. The release usually succeeds on retry. If it fails
  mid-publish, delete the partial draft (`gh release delete v<x.y.z>
  --repo Ben-McCloskey/japanese-reading-companion --yes`), `rm -rf
  release/<x.y.z>`, and re-run `npm run release`.

### iOS-specific

- **Main process changes don't hot-reload on Mac dev**, but on iOS
  there's no main process — the renderer hot-reloads via `cap copy ios`
  during dev, but anything in `src/platform/capacitor-*.ts` only takes
  effect after a full Xcode rebuild. **Force-quit the app on the device**
  (swipe up from app switcher) to be sure the new bundle is picked up;
  Xcode caches storyboard compilations aggressively, so ⌘⇧K (Clean Build
  Folder) before ⌘R when in doubt.
- **JMdict download is HTTP**, not HTTPS — edrdg.org doesn't offer TLS on
  `JMdict_e.gz`. iOS blocks cleartext by default; the `Info.plist` has an
  `NSAppTransportSecurity` exception scoped to `edrdg.org` and
  subdomains. Don't widen this exception.
- **Capacitor SQLite has high per-call overhead** on iOS — `executeTransaction`
  does one bridge round-trip per statement. For bulk inserts use
  `conn.execute(oneBigSqlString, /* transaction */ false)` with multi-row
  `VALUES` and a manual `BEGIN;…COMMIT;`. See `bulkInsert` in
  `src/platform/capacitor-jmdict.ts` for the canonical pattern (~30-50×
  faster than the naive batched-statement approach).
- **`IcloudSyncPlugin` registration**: Capacitor 6 only auto-discovers
  plugins shipped via CocoaPods. App-level Swift plugins must be
  registered explicitly. `MainViewController` (in
  `IcloudSyncPlugin.swift`) overrides `capacitorDidLoad` to call
  `bridge?.registerPluginInstance(IcloudSyncPlugin())`. The
  `Main.storyboard`'s root view-controller class must reference
  `MainViewController` (module=`App`), not the default
  `CAPBridgeViewController`.
- **iCloud container ID** is `iCloud.com.benmccloskey.JapaneseReadingCompanion`
  — duplicated in three places: `App.entitlements`, `Info.plist`'s
  `NSUbiquitousContainers`, and the Swift plugin code. Keep them in sync
  if it ever changes.

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

- Mac: SQLite at `app.getPath('userData')/jrc.sqlite`, WAL mode, foreign
  keys ON, via `better-sqlite3`.
- iOS: SQLite at the Capacitor SQLite default location
  (`Library/CapacitorDatabase/jrcSQLite.db`), accessed through
  `@capacitor-community/sqlite`.
- The migrations live in `src/main/db/migrations/` as `.sql` files. **Both
  platforms run the same migrations** — `vite.web.config.ts` imports them
  via `?raw`, same as the Electron build. **Never edit a shipped
  migration** — add a new one.
- Currently shipped migrations:
  - `0001_init.sql` — settings table + bookkeeping
  - `0002_app_tables.sql` — sessions, words, srs_state, reviews, jmdict
    cache, jlpt_levels
  - `0003_appearances.sql` — `word_session_appearances` for "times seen"
  - `0004_sync_events.sql` — `sync_events` (the local event log) +
    `sync_peers` (per-peer pull cursors)
- Mac DB access goes through repos in `src/main/db/repos/` (prepared
  statements, multi-statement writes wrap in `db.transaction(...)`).
- iOS DB access goes through helpers in `src/platform/capacitor-db.ts`:
  `query`, `queryOne`, `run`, `runTransaction`. For bulk imports, use
  `(await db()).execute(sqlString, false)` directly — see iOS gotcha
  above.
- **No string-interpolated SQL anywhere** for user-influenced data — bind
  values via prepared statements / parameter arrays. The only exception is
  the JMdict bulk-import path on iOS, which inlines values for perf and
  uses an explicit `sqlString()` escape because that data is from a
  trusted source (the JMdict XML we just downloaded).

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

## Sync

The sync engine is structurally the same on both platforms — same event
shapes, same idempotent replay rules, same iCloud folder layout. What
differs is the I/O layer.

**Event log model**:

- Every local mutation (add word, remove word, save session, submit
  review, change a synced setting) appends a row to `sync_events` with a
  sortable id (`{ISO timestamp}-{uuid}`).
- The engine pushes new events (since `syncLastPushedId`) to
  `Documents/sync/events-<deviceId>.jsonl` in the app's iCloud container.
- It also reads peer JSONL files, dedupes events by id (`sync_events.id`
  is the PK), and applies new ones via the platform's replayer.
- Cursor per peer is in `sync_peers`.

**Replayer rules** (must hold in both `src/main/services/sync/event-replay.ts`
and `src/platform/capacitor-replayer.ts`):

- Use **natural keys** for resolution, not auto-increment ids — surface +
  reading for words, raw_text for sessions. Auto-increment ids differ
  across devices.
- **Idempotent**: running the replayer twice on the same event must be a
  no-op. Re-ingesting the same event id is rejected at the SQL level
  (`ON CONFLICT(id) DO NOTHING`).
- **Last-write-wins on SRS state** by `reviewedAt`. The local row is
  updated only if the incoming event's `reviewedAt` is newer than the
  local `last_reviewed_at`.
- **Replay must NOT echo events**. The replayer wraps its application in
  `withReplaying(...)` (Mac) / setting `replaying = true` (iOS), which
  short-circuits `eventLog.append` so locally-triggered mutations during
  replay don't create new sync_events rows. Without this guard, peers
  re-publish each other's events forever.

**Driver** (platform I/O):

- Mac (`src/main/services/sync/icloud-driver.ts`) uses Node `fs.watch`
  for change detection and direct file appends via `fs/promises`.
- iOS (`src/platform/capacitor-icloud-driver.ts`) goes through the Swift
  plugin (Capacitor Filesystem can't see the iCloud container) and polls
  for changes.

**Engine throttling**: the iOS engine has `MIN_CYCLE_GAP_MS = 2000` to
keep cascading `pendingRun` triggers from monopolizing the bridge.
Without it, certain local mutation patterns can trigger ~30 cycles/sec.
Don't remove it without thinking through the alternative throttle.

**Backfill**: on Mac, Settings → Sync has a one-shot **"Backfill from
existing data"** button that emits sync events for every word and
session currently in the DB so a fresh peer (e.g. iPhone first install)
can catch up to existing state instead of only forward-going changes.
Implementation in `src/main/services/sync/backfill.ts`. Idempotent —
safe to run multiple times.

**What syncs vs. doesn't**:

- ✅ Words (add/remove/mark-known), sessions, review submissions,
  synced settings (`SYNCED_SETTING_KEYS` in `src/shared/types/sync.ts`)
- ❌ JMdict tables — too large, each device imports its own copy
- ❌ Per-device review *history* (the `reviews` audit log) — only the
  resulting SRS state syncs

When adding a new mutation that should sync:

1. Add a new event kind to `SyncEventKind` + payload type in
   `src/shared/types/sync.ts`.
2. After the local DB write, `eventLog.append('your.kind', payload)`.
3. Implement the replay branch in **both** `event-replay.ts` and
   `capacitor-replayer.ts` — use natural keys, no auto-increment ids.
4. Call `syncEngine.notifyLocalChange()` (or `syncEngine.run()`) to push
   the new event promptly.

## Daily review cap + persistence

- Cap is stored in setting `dailyReviewCap` (default 20, `0` = unlimited).
- Today's done count persists across launches in two settings:
  `reviewsDoneDate` (YYYY-MM-DD local time) + `reviewsDoneCount`. Resets at
  local midnight (compared to `todayLocalDate()` in
  `src/renderer/lib/daily-review.ts`).
- Queue is truncated client-side to `cap - persistedDone`.

## Performance expectations

- Tokenizing 500 chars: <100 ms after warmup.
- Lookup panel after click: <50 ms on Mac (single indexed SQLite query
  through `jmdict_index`); <150 ms on iOS (one Capacitor SQLite bridge
  call, slower than better-sqlite3 but still imperceptible).
- Reading view should handle pasted text up to ~5 000 characters without lag.
- JMdict import: ~30–60 s on Mac, ~1–2 min on iOS (when using the
  multi-row `execute()` path; the naive batched-statement path is ~15
  min on iPhone — don't regress that).
- Sync push/pull cycle: bounded by iCloud Drive propagation (typically
  30 s–2 min), not by app code. The local engine cycle itself is
  sub-second.

If you add something that might slow these down, measure it.

## Testing

- Unit tests for: FSRS wrapper, sync replayer (idempotency + LWW
  semantics). Add tests for tokenization helpers, conjugation analysis,
  sentence extraction if you change them.
- No need for full E2E or React component tests unless something breaks
  repeatedly.
- Test data lives next to code (`*.test.ts`). vitest config:
  `vitest.config.ts` with the same `@shared` / `@main` / `@renderer`
  aliases as the runtime build.
- Sync changes that touch the replayer: extend
  `event-replay.test.ts` to cover the new event kind + idempotency. The
  Capacitor replayer mirrors the same logic but isn't unit-tested
  (different SQLite client; tests would need a fixture). Keep the two
  implementations in lock-step.

## Distribution & updates

### Mac

- App ships as a macOS DMG (and ZIP) via `npm run release`. Uploads as a
  **draft** to public GitHub repo
  `Ben-McCloskey/japanese-reading-companion`. Drafts must be manually
  published on github.com to actually go live.
- Auto-updater (`electron-updater`) polls the same repo every 30 minutes,
  downloads new versions in the background, surfaces a cinnabar
  "update ready" button in the sidebar footer. One click → `quitAndInstall`.
- `GH_TOKEN` is required for the *upload* step (publishing) but the
  installed app reads from the public repo without auth — no token in the
  bundle. See `RELEASING.md`.

### iOS

- Sideload-only via Xcode. `npm run ios:sync` rebuilds the web bundle and
  copies it into the iOS project; `npm run ios:open` opens the workspace;
  ⌘R installs on a connected iPhone (with a free or paid Apple Developer
  account configured in Xcode → Signing & Capabilities).
- No App Store / TestFlight pipeline. Each version of the iOS app is
  manually rebuilt + reinstalled.
- iOS doesn't auto-update. After a `git pull`, run `npm run ios:sync`
  and rebuild in Xcode to roll out new code to the iPhone.

## What NOT to do

- ❌ No cloud services, no API calls to external servers. The only
  network surface is: JMdict download on first run (per device), GitHub
  Releases for Mac auto-updates, and the user's own iCloud Drive for
  device-to-device sync. Don't add anything else.
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
- ❌ Don't add Electron-only APIs (Node `fs`, `app.getPath`, etc.)
  directly to renderer code. They'll silently break the iOS build.
  Anything platform-specific goes through `@platform`.
- ❌ Don't widen the iCloud sync payload to include large/derivable data
  (JMdict, processed_tokens_json for sessions other than what's already
  there). iCloud per-app storage is shared with the user's iCloud quota.

## Working style

- The original 7-phase plan + iOS-and-sync expansion are **complete**.
  Current work is incremental polish, bug-fixing, and the deferred items
  in [`BUILD_SPEC.md`](BUILD_SPEC.md)'s "What's NOT yet shipped". Surface
  a brief "here's what I'll change" before writing code if the change
  touches multiple files.
- **For sync changes**: surface intent before coding because mistakes can
  fan out to the user's iCloud and silently corrupt peer state. Walk
  through the replay semantics and natural-key choice with the user
  first.
- **For iOS changes**: the iPhone is a real device the user is using
  daily. Don't ship code that requires the user to wipe and re-import
  JMdict (~2 min) without flagging it.
- When unsure between two approaches, ask before implementing — don't pick
  silently.
- When a task feels larger than expected, surface it early rather than
  disappearing into a long autonomous session.
- Keep this file updated. Discovered a non-obvious gotcha while working? Add
  it to the relevant section here.
