# Japanese Reading Companion

A local-first reading + spaced-repetition app for Japanese. Native macOS
(Electron) and sideloaded iOS (Capacitor), with the user's deck and reading
history kept in sync across both via their own iCloud Drive. Paste a
message, hover/tap any kanji to see its reading, click for the dictionary
entry, add the words you want to study, review them on an FSRS schedule.

No servers. No accounts. No telemetry. Single user. SQLite + JMdict +
kuromoji on each device; sync is plain JSONL files in the app's iCloud
container.

> Read [`BUILD_SPEC.md`](BUILD_SPEC.md) for the full feature surface,
> [`CLAUDE.md`](CLAUDE.md) for editing-this-codebase guidance, and
> [`RELEASING.md`](RELEASING.md) for the Mac release / auto-update workflow.

## Setup

```bash
npm install

# Mac
npm run dev          # launch Electron with hot reload
npm run typecheck    # strict TypeScript across both build targets
npm run test         # vitest (FSRS + sync replayer)
npm run build        # production Electron build into out/
npm run package      # build a macOS DMG + ZIP into release/
npm run release      # build + upload as draft to public GitHub repo
npm run db:reset     # delete the local SQLite database

# iOS (sideload only — no App Store)
npm run ios:sync     # build the web bundle + cap sync
npm run ios:open     # open the Xcode workspace; ⌘⇧K then ⌘R to install
```

First launch on each device downloads JMdict (~13 MB gzipped) from
edrdg.org and parses it into SQLite — ~1 min on Mac, ~2 min on iPhone.
After that the dictionary is offline and the only network is iCloud
sync (the user's own iCloud Drive) and the Mac's GitHub auto-updater.

## Architecture (one paragraph)

Same React renderer on both platforms; the platform layer in
**`src/platform/`** implements one shared `Api` interface twice. On Mac
it's the classic three-process Electron split (main / preload / renderer),
with `better-sqlite3` and Node `fs.watch`-based sync. On iOS it's a single
WKWebView with `@capacitor-community/sqlite`, a small Swift plugin
(`IcloudSyncPlugin`) for the iCloud container Capacitor Filesystem can't
reach, and polling-based sync. Both sides share the same SQL migrations,
the same event-log sync model, and the same renderer code. Components
NEVER reach for Electron or Capacitor APIs directly — they go through
`@platform`.

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
   Japanese voice, re-import the dictionary, configure the sync folder.
9. `npm test` — unit tests pass (FSRS wrapper + sync replayer).

### iOS smoke test (additional)

1. `npm run ios:sync && npm run ios:open` — opens the Xcode workspace.
   Configure signing under the App target's Signing & Capabilities tab if
   it's a fresh checkout.
2. ⌘⇧K (Clean Build Folder) → ⌘R with the iPhone connected. App
   launches to SetupPage on first install — tap **Download dictionary**,
   wait ~2 min for the import.
3. **Settings → Sync** on Mac: paste the iCloud container path
   (`~/Library/Mobile Documents/iCloud~com~benmccloskey~JapaneseReadingCompanion/Documents/sync`).
   Tap **Backfill from existing data** to seed the iPhone with your
   existing deck.
4. Add a word on iPhone → wait ~1 min → it appears in the Mac's My Words
   list. Reverse direction works the same.

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
