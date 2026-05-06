# Japanese Reading Companion

A local-only macOS desktop app for reading Japanese with on-demand furigana
and a spaced-repetition flashcard deck built from your real reading. Paste a
message, hover any kanji to see its reading, click for the dictionary entry,
add the words you want to study, review them on an FSRS schedule.

No cloud. No accounts. No telemetry. Single user. SQLite + JMdict + kuromoji,
all local.

> Read [`BUILD_SPEC.md`](BUILD_SPEC.md) for the full feature surface,
> [`CLAUDE.md`](CLAUDE.md) for editing-this-codebase guidance, and
> [`RELEASING.md`](RELEASING.md) for the release / auto-update workflow.

## Setup

```bash
npm install
npm run dev          # launch with hot reload
npm run typecheck    # strict TypeScript across main + renderer
npm run test         # vitest (FSRS wrapper)
npm run build        # production build into out/
npm run package      # build a macOS DMG + ZIP into release/
npm run release      # build + upload as draft to public GitHub repo
npm run db:reset     # delete the local SQLite database
```

First launch downloads JMdict (~13 MB gzipped) from edrdg.org and parses it
into SQLite — takes about a minute. After that everything is offline.

## Architecture (one paragraph)

Three Electron processes, hard-separated. **`src/main/`** owns SQLite (via
`better-sqlite3`), the JMdict downloader/parser, kuromoji, FSRS, and the
auto-updater. **`src/preload/`** exposes a typed `window.api` to the renderer
through `contextBridge`. **`src/renderer/`** is the React UI and never touches
the DB or filesystem directly. **`src/shared/`** is the type contract between
the two sides. `contextIsolation` is on, `nodeIntegration` is off,
`sandbox: true`. Don't change that.

## Smoke test (after install)

1. `npm install && npm run dev` — window opens to the Setup screen on first
   run. Click **Download dictionary**, wait for the parser to finish.
2. Paste any Japanese text into the textarea, press `⌘↵`. The text renders
   inline with furigana revealed on hover.
3. Click a content word — the lookup panel slides in from the right with
   reading, JLPT badge if known, conjugation breakdown, JMdict senses, and
   a 🔊 button.
4. Click **Add to deck**. A subtle colored underline appears below the word
   in the reading view.
5. Switch to **Review** (`⌘2`). Cards added today aren't due yet (4 hour
   delay) — you'll see the empty state. Come back later or drop the delay
   to test (`src/main/db/repos/srs-repo.ts` → `markNew`).
6. **My Words** (`⌘4`) — the word is listed with its status, "seen 1" count,
   and the review schedule.
7. **Sessions** (`⌘3`) — the paste is saved as a session you can re-open.
8. **Settings** (`⌘5`) — toggle dark mode, set a daily review cap, pick a
   Japanese voice, re-import the dictionary.
9. `npm test` — FSRS wrapper unit tests pass.

## Distribution & updates

App publishes to the public GitHub repo
[`Ben-McCloskey/japanese-reading-companion`](https://github.com/Ben-McCloskey/japanese-reading-companion)
via `electron-updater`. After the one-time setup in
[`RELEASING.md`](RELEASING.md), shipping a new version is:

```bash
npm version patch     # 0.1.x → 0.1.(x+1)
npm run release       # builds, signs ad-hoc, uploads draft
```

Then click **Publish release** on github.com. Already-installed copies pick
up the update within 30 minutes (or instantly on next launch) and surface a
cinnabar **"update ready · click to restart"** button in the sidebar footer.
One click upgrades, SQLite data preserved.

## License

Personal project. Not licensed for redistribution.
