# Japanese Reading Companion

## What this is

A local-only macOS desktop app for reading Japanese with furigana and a
spaced-repetition flashcard deck built from your real reading. Built for one
user (fluent at speaking Japanese, weak at kanji recognition) who receives
Japanese messages every day at work and was previously copy-pasting them into
Google Translate just to read them.

Every UX choice optimizes for **fast daily use**: paste text, see it with
furigana on demand, click a word to look it up, add the words you want to
study to a deck, review them on a schedule. No cloud, no accounts, no
telemetry.

## Tech stack

- **Framework**: Electron 32 + React 18 + TypeScript (strict, with
  `noUncheckedIndexedAccess`) + Vite (`electron-vite`)
- **Styling**: Tailwind CSS 3, shadcn-style copy-in components (Toggle,
  speaker button, etc.)
- **Tokenizer**: `kuromoji` for Japanese morphological analysis (in-process,
  no external MeCab)
- **Dictionary**: JMdict (the standard free Japanese-English dictionary),
  downloaded from edrdg.org on first run, parsed with `sax`, cached in
  SQLite
- **Database**: SQLite via `better-sqlite3` (synchronous, fast, perfect for
  single-user desktop)
- **SRS algorithm**: `ts-fsrs` (FSRS — modern Anki successor)
- **TTS**: Web Speech API using OS-installed Japanese voices
- **Auto-updates**: `electron-updater` against a public GitHub Releases
  repo

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
indeterminate animation during sax parsing. ~30–60 s end-to-end. SetupPage
gates the rest of the app via `useDictStatus()` — `unknown` / `needs-import`
/ `importing` / `failed` all show Setup; `ready` lets through.

### Distribution

- `npm run package` produces a DMG and ZIP at `release/<version>/`.
- `npm run release` does the same and uploads as a **draft** to the public
  GitHub repo `Ben-McCloskey/japanese-reading-companion`. The `GH_TOKEN`
  env var is used to authenticate the upload; the installed app reads
  releases from the public repo without auth (electron-updater 6.x has
  multiple unfixed bugs around private GitHub repos that pushed the
  decision toward going public).
- App polls GitHub every 30 min (and on launch); when an update arrives,
  the sidebar footer shows a cinnabar **"update ready · vX.Y.Z · click to
  restart"** button. One click → `quitAndInstall` → app relaunches on the
  new version with all SQLite data intact.
- Full release walk-through in [`RELEASING.md`](RELEASING.md).

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

jmdict_entries / jmdict_index             -- cached dictionary
jlpt_levels                               -- key (surface or reading) → 1..5
settings                                  -- key/value, dark mode, daily cap,
                                          --   tts voice, reviews-done bookkeeping
```

Schema lives in three migration files (`0001_init`, `0002_app_tables`,
`0003_appearances`) under `src/main/db/migrations/`. New schema additions
get a new numbered file — never edit a shipped migration.

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

## What's NOT in v1

Deferred or skipped intentionally:

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
