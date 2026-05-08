# Japanese Reading Companion

## What this is

A local-first reading + spaced-repetition app for Japanese. Native macOS
app + sideloaded iOS app, with the user's deck and reading history kept in
sync across both via their own iCloud Drive. Built for one user (fluent at
speaking Japanese, weak at kanji recognition) who reads Japanese messages
every day at work.

Every UX choice optimizes for **fast daily use**: paste text, see it with
furigana on demand, tap a word to look it up, add words to a deck, review
them on a schedule.

**No servers, no accounts, no telemetry.** The dictionary downloads from
edrdg.org on first run; auto-updates pull from GitHub Releases; sync runs
through the user's own iCloud Drive container. That's the entire network
surface.

## Tech stack

### Shared (both platforms)

- **Renderer**: React 18 + TypeScript (strict, with
  `noUncheckedIndexedAccess`) + Tailwind CSS 3
- **Tokenizer**: `kuromoji` — pure-JS Japanese morphological analysis, runs
  in the renderer on both platforms
- **Dictionary**: JMdict, parsed with `sax` and cached locally
- **SRS algorithm**: `ts-fsrs` (FSRS — modern Anki successor)
- **TTS**: Web Speech API using OS-installed voices

### Mac (Electron 32)

- `electron-vite` for the build pipeline
- `better-sqlite3` for the database (synchronous, fast, main-process only)
- `electron-updater` against a public GitHub Releases repo
- Node `fs.watch` for sync — reacts to peer file changes immediately

### iOS (Capacitor 6)

- WKWebView wraps the same React renderer; `vite.web.config.ts` produces a
  separate static bundle
- `@capacitor-community/sqlite` for the database (one bridge call per
  query, so bulk inserts use `execute()` with multi-row VALUES)
- `pako` for streaming gunzip during JMdict import (fetch → Inflate → sax
  → batched insert)
- A small **Swift plugin (`IcloudSyncPlugin`)** because Capacitor
  Filesystem can't reach the iCloud Documents container
- Polling-based sync (no `fs.watch` equivalent in the WKWebView sandbox)

The platform split lives in [`src/platform/`](src/platform/) — both sides
implement the same `Api` interface, the renderer never knows which
platform it's on.

## Features (all shipped)

### Reading view (`読 · read`)

- Paste any Japanese text. `Cmd+Enter` or the Tokenize button parses it.
- Renders inline left-to-right (not as a list) with HTML `<ruby>` tags over
  kanji-containing words.
- **Furigana hides until hovered** — kanji renders bare; hovering, focusing,
  or selecting a word fades the hiragana reading in over 140 ms. Layout
  pre-allocates the ruby space so nothing reflows.
- Each non-particle word is clickable; particles, punctuation, and aux verbs
  are dimmed and inert.
- **Click → Word panel** slides in from the right (240 ms ease-out-strong
  with `@starting-style`). Shows: dictionary form, hiragana reading, JLPT
  badge if known, part-of-speech, conjugation breakdown
  (`食べました → 食べる · te-form stem`-style), all JMdict senses with English
  glosses, and example sentences when the dictionary entry has them.
- **In-deck words** get a thin 2 px underline below the kanji, color-coded
  by SRS state (indigo for new/learning/review, sage for known, rust for
  lapsed). Underline is straight (drawn via a `::after` pseudo-element so
  the rounded hover background doesn't curve the tips), sits a few pixels
  below the bounding box.
- Top-right of the textarea: a **clipboard icon** when empty (paste +
  auto-tokenize in one click) or an **× button** when filled (clears the
  textarea + tokens + panel).
- 🔊 **TTS button** beside the reading. Uses the user's selected Japanese
  voice (configurable in Settings). Auto-prefers Premium > Enhanced > Standard.

### Review (`復 · review`)

- Card front: huge display-serif kanji + the **original sentence** the word
  was first encountered in (italic, quoted) — the killer differentiator vs.
  plain Anki.
- Press **Space** or click to flip → reveals reading, JLPT badge,
  numbered senses with POS, source sentence again. Has its own 🔊 button.
- Rate with **1 / 2 / 3 / 4** keys → Again / Hard / Good / Easy. Each rating
  runs `applyRating → applyPatch → reviews.log` in a single SQLite
  transaction.
- Header counter: `X due · Y done · Z left` — `done` persists across app
  launches (settings keys `reviewsDoneDate` + `reviewsDoneCount`, resets at
  local midnight).
- **Daily cap** (default 20, configurable, `0` = unlimited) truncates the
  queue and includes today's already-done count.
- **4-hour first-review delay** for newly-added words — looking up a
  definition and "reviewing" 30 seconds later defeats the point.
- Empty state: "Nothing to review — go read something." or "All done." after
  a session.

### Sessions (`記 · sessions`)

- Every tokenize is saved as a session (raw text + parsed token list +
  auto-generated title + timestamp). Re-tokenizing the same text reuses the
  prior session row instead of duplicating.
- List view: timestamp (`HH:MM` if today, `Mon DD` otherwise) + title + "N
  new words added" count.
- Click **open** to reload the session in the Reading view — text restored,
  tokens restored (no re-tokenize needed), deck states refreshed so
  underlines reflect today's state.
- **Two-step delete confirm** (click → "confirm?" → second click within 4 s).

### My Words (`語 · words`)

- Searchable, filterable list of every word in the deck.
- **Filter chips**: status (new / learning / review / lapsed / known, with
  live counts) + JLPT level (N5 → N1). Multi-select.
- **Search box** matches surface or reading (case-insensitive `LIKE`).
- Columns: word + reading + JLPT badge | status (color dot + label) | seen
  (cross-session appearance count) | reviews | due (humanized: `today`,
  `tomorrow`, `3d`, `2w`, `4mo`).
- **Multi-select rows + bulk action bar**: Mark as known | Delete (cinnabar
  destructive). Bar materializes via `fade-rise` only when ≥1 row is
  selected.

### Settings (`設 · settings`)

Grouped sections, each in a card:

- **Display** — Dark mode toggle (sumi-ink palette). Persists.
- **Review** — Daily cap input.
- **Pronunciation** — Voice picker dropdown (lists all Japanese voices on
  the system, sorted Premium > Enhanced > Standard). Inline hint explains how
  to download Enhanced/Premium voices via macOS System Settings.
- **Dictionary** — "Re-import" button. Triggers `dict:import` and routes
  through the SetupPage progress UI. Deck and review history preserved.
- **Shortcuts** — Read-only reference of every keyboard shortcut.

### First-run experience

On first launch, app shows the **Setup screen** instead of the main UI:
warm intro copy, single primary "Download dictionary" button, soft progress
bar that fills during the gzipped fetch from edrdg.org, then flips to an
indeterminate animation during sax parsing. SetupPage gates the rest of
the app via `useDictStatus()` — `unknown` / `needs-import` / `importing` /
`failed` all show Setup; `ready` lets through.

Timing per platform:

- **Mac**: ~30–60 s end-to-end (better-sqlite3 is fast; one transaction
  per 500-entry batch).
- **iOS**: ~1–2 min (Capacitor SQLite bridge has per-call overhead, so
  inserts use multi-row VALUES inside a single `execute()` per batch — see
  the iOS-specific gotcha in [`CLAUDE.md`](CLAUDE.md)).

### iCloud sync

Both devices write append-only event logs to a shared folder inside the
user's iCloud Drive (`Documents/sync/events-<deviceId>.jsonl`). The folder
lives in the app's iCloud container — Apple's daemon handles the actual
device-to-device transfer; the app just reads/writes a local folder.

What syncs:

- **Words** — adding to deck, removing, marking as known
- **Sessions** — every save (raw text + tokens)
- **Reviews** — every rating + the resulting SRS state
- **Synced settings** — daily review cap, theme, TTS voice (via
  `SYNCED_SETTING_KEYS` in `src/shared/types/sync.ts`)

What doesn't:

- JMdict tables — too large to push through iCloud; each device imports
  its own copy from edrdg.
- Per-device review *history* (the `reviews` audit log) is not replicated
  beyond the snapshot embedded in the latest event. Each device only sees
  its own historical review rows.

Conflict resolution:

- **Words / sessions / settings** — natural-key upsert (idempotent).
  Surface+reading for words, raw_text for sessions, key for settings.
- **SRS state** — last-write-wins by `reviewedAt`. If you happen to review
  the same card on both devices while disconnected, the more recent
  review wins; the earlier one's effect on scheduling is lost.

Offline-tolerant:

- Each device only writes to its own peer file, so there's nothing to
  merge — peers are append-only logs. Use both devices on a flight
  with no network and they'll converge when iCloud reconnects.
- iCloud isn't instant. Even with both devices online, propagation can
  take 30 s–2 min. The "Sync now" button in Settings forces a local pull;
  iCloud's own propagation is its own pace.

Backfill: a one-shot **"Backfill from existing data"** button in the
Mac's Sync settings emits sync events for every existing word and session
so a fresh peer (e.g. iPhone first install) sees the full deck instead of
only forward-going changes. Idempotent — safe to run multiple times.

### Distribution

**Mac** ships as a DMG + ZIP via `npm run release`, uploaded as a
**draft** to the public GitHub repo `Ben-McCloskey/japanese-reading-companion`.
You manually publish the draft on github.com to make it live; the auto-
updater (`electron-updater`) polls every 30 min (and on launch); when an
update arrives, the sidebar footer shows a cinnabar **"update ready ·
vX.Y.Z · click to restart"** button. One click → `quitAndInstall` → app
relaunches on the new version with all SQLite data intact. `GH_TOKEN` is
required for the *upload* step; the installed app reads releases from the
public repo without auth. Full walk-through in [`RELEASING.md`](RELEASING.md).

**iOS** is currently sideloaded via Xcode — `npm run ios:sync && npm run
ios:open`, then ⌘R on the connected iPhone. There's no App Store /
TestFlight pipeline configured. App Store distribution would need an
Apple Developer account, provisioning profiles, and a `xcode-build`
pipeline; deferred until/unless multi-user demand appears.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `⌘ ↵` | Tokenize the textarea |
| `Esc` | Close the lookup panel |
| `Space` / `Enter` | Flip the flashcard |
| `1` / `2` / `3` / `4` | Rate Again / Hard / Good / Easy |
| `⌘ 1`–`5` | Switch sidebar section |

Inputs and textareas don't intercept these.

## Data model

```
sessions
  id, created_at, title, raw_text, processed_tokens_json

words
  id, surface (dictionary form), reading (hiragana), jlpt_level, pos,
  meanings_json, example_sentences_json, created_at,
  first_session_id, first_sentence
  UNIQUE(surface, reading)

srs_state                                 -- one row per word
  word_id, state ('new'|'learning'|'review'|'lapsed'|'known'),
  due_date (ISO ts), stability, difficulty, review_count, lapse_count,
  last_reviewed_at

reviews                                   -- append-only audit log
  id, word_id, reviewed_at, rating (1-4), interval_before, interval_after,
  stability_before, stability_after

word_session_appearances                  -- "times seen" bridge
  (word_id, session_id) PK, count
  -- updated when a session is saved (per-token tally) and when a word is
  -- added to deck (retroactive scan across all existing sessions)

sync_events                               -- append-only sync log
  id (sortable: ISO ts + uuid), device_id, ts, kind, payload_json
  -- one row per local mutation; pushed to iCloud as JSONL
  -- ingested rows from peers also land here for dedup

sync_peers                                -- per-peer pull cursor
  device_id PK, last_event_id, last_seen_at

jmdict_entries / jmdict_index             -- cached dictionary
jlpt_levels                               -- key (surface or reading) → 1..5
settings                                  -- key/value, dark mode, daily cap,
                                          --   tts voice, reviews-done bookkeeping,
                                          --   deviceId, syncFolder, syncLastPushedId
```

Schema lives in four migration files under `src/main/db/migrations/`:

- `0001_init.sql` — settings + bookkeeping
- `0002_app_tables.sql` — sessions, words, srs_state, reviews, jmdict, jlpt
- `0003_appearances.sql` — `word_session_appearances`
- `0004_sync_events.sql` — `sync_events` + `sync_peers`

New schema additions get a new numbered file — never edit a shipped
migration.

## Design system

- **Palette**:
  - Light: paper `hsl(39 33% 97%)`, ink `hsl(30 8% 12%)`, cinnabar accent
    `hsl(8 52% 44%)`
  - Dark: sumi `hsl(30 8% 7%)`, rice `hsl(38 24% 90%)`, cinnabar accent
    `hsl(8 58% 56%)`
  - SRS status colors: indigo (learning), sage (known), rust (lapsed)
- **Typography**:
  - Display serif: Hiragino Mincho ProN → Yu Mincho → Noto Serif JP
  - Sans body: Hiragino Sans → Yu Gothic UI → Noto Sans JP →
    `-apple-system`
- **Motion**:
  - `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)` for entrances and
    UI presses
  - Hover: `transition-[background-color] duration-100` (default `ease`)
  - Press feedback: `active:scale-[0.97]` on every pressable element
  - Panel entrance: `@starting-style` + 240 ms slide-from-right + opacity
  - Result reveals: `fade-rise` (4 px translateY + opacity, 280 ms)
  - `prefers-reduced-motion` strips transforms, keeps shortened opacity
    transitions
- **Sidebar / pages**: lowercase tracked-out nav labels, calm hairline
  borders, generous whitespace.

## What's NOT yet shipped

Deferred or skipped intentionally:

- **iOS via App Store / TestFlight** — currently sideloaded through Xcode
  only. App Store distribution would need an Apple Developer account,
  provisioning profiles, and a build pipeline. Deferred until multi-user
  demand appears.
- **Cross-device review history replication** — sync carries forward the
  current SRS state per word, not the full per-card review log. Each
  device only sees its own historical `reviews` rows. Adding history sync
  is doable but increases iCloud payload size meaningfully.
- **Tatoeba example sentences** — the standard `JMdict_e.gz` from edrdg
  doesn't include `<example>` elements, so most senses ship without
  examples. The parser captures them when present; populating from Tatoeba
  is a future enhancement.
- **JLPT vocabulary data** — schema and importer are in place, but the
  bundled `src/main/data/jlpt-levels.json` ships empty by default. The user
  can drop a populated list at `<userData>/jlpt-levels.json` (the importer
  prefers it over the bundled seed).
- **Windows / Linux builds** — `electron-builder.yml` has targets configured
  but only the macOS DMG is exercised.
- **App notarization** — the build is ad-hoc-signed with the user's local
  identity. macOS shows the unsigned warning on first launch (right-click →
  Open). Personal-use friction is fine.
- **Bridging `Again`-rated cards back into the same review session** — they
  reschedule per FSRS and re-appear on the next due date.

## Where to read what

- [`CLAUDE.md`](CLAUDE.md) — guidance for editing this codebase. Read first.
- [`RELEASING.md`](RELEASING.md) — release + auto-update workflow.
- [`README.md`](README.md) — quick setup + acceptance smoke test.
- [`src/main/data/README.md`](src/main/data/README.md) — JLPT data format.
