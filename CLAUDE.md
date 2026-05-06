# CLAUDE.md

Guidance for working in this codebase. Read this first before making changes.

## Project context

This is a personal desktop app for reading Japanese text with furigana support and a built-in SRS (Anki-style flashcard system) driven by the user's actual reading history. The user is fluent in spoken Japanese but weak at kanji recognition. Every UX decision should optimize for **fast daily use** over feature breadth. See `BUILD_SPEC.md` for the full feature spec.

## Frontend Design

When creating, editing, or changing anything on the frontend ALWAYS use the frontend design skill and the emil design skill.

## Architecture

Electron app with three processes — keep them clearly separated:

- **`src/main/`** — Electron main process. Owns SQLite (`better-sqlite3` only works here), filesystem, JMdict parsing, app lifecycle. No React, no DOM.
- **`src/renderer/`** — React UI. No direct database or filesystem access. Talks to main only via IPC.
- **`src/preload/`** — Preload script that exposes a typed `window.api` to the renderer via `contextBridge`. This is the **only** bridge between processes.
- **`src/shared/`** — Types and constants used by both sides (e.g., `Word`, `SrsState`, IPC channel names).

**IPC rule**: every IPC handler is registered in main with a typed channel constant from `src/shared/ipc.ts`, exposed in preload, and called from renderer via `window.api.*`. Never use `ipcRenderer` directly in components.

**Context isolation must stay enabled.** Never disable `contextIsolation` or enable `nodeIntegration` in the renderer.

## Commands

```bash
npm run dev          # start dev with hot reload
npm run build        # production build
npm run package      # build platform-specific installer
npm run typecheck    # tsc --noEmit, must pass before any commit
npm run lint         # eslint
npm run test         # vitest
npm run db:reset     # delete the SQLite file (keep JMdict cache); useful when iterating on schema
```

If a command isn't here yet, add it and update this file.

## Code conventions

- **TypeScript strict mode is on.** No `any` without a `// eslint-disable` comment explaining why.
- **No default exports** except for React components and Electron entry points.
- **Files use kebab-case**, components use PascalCase: `word-lookup-panel.tsx` exports `WordLookupPanel`.
- **Keep components small.** If a component is over ~150 lines, split it.
- **Business logic lives outside components.** FSRS scheduling, tokenization, dictionary lookups all live in plain TS modules under `src/main/services/` or `src/renderer/lib/` and are unit-tested independently.
- **Errors are never silently swallowed.** Catch them, log them, surface them to the UI via a toast or inline message.

## Database

- SQLite schema lives in `src/main/db/schema.sql` and is applied via a numbered migrations system in `src/main/db/migrations/`. Never modify a migration that has already shipped — add a new one.
- Use **prepared statements** for everything. No string-interpolated SQL, ever.
- Wrap multi-statement writes in transactions (`db.transaction(...)`).
- All DB access goes through repository modules in `src/main/db/repos/` (e.g., `words-repo.ts`, `srs-repo.ts`). Components never see SQL.

## Japanese-specific gotchas

- **Always tokenize on the dictionary form**, not the surface form, when adding to the deck. Kuromoji's `basic_form` field is what you want — `食べました` → store `食べる`.
- **Ruby tags only over kanji-containing tokens.** Don't wrap pure kana in `<ruby>` — it's noisy and ugly.
- **Kuromoji has a 1–2 second warmup** on first tokenization. Pre-warm it on app start, in the main process, and expose a "ready" signal to the renderer. Show a subtle loading state until ready.
- **JMdict is large** (~80MB XML). Parse it once on first run, store in SQLite, and never re-parse. Cache the parsed version in `app.getPath('userData')`.
- **Furigana font sizing**: ~0.5em relative to the base text. Use `ruby-position: over` and `ruby-align: center`. Test with mixed kanji/kana sentences before declaring it done.
- **Counter words and particles** (の, を, は, に, etc.) should NOT be auto-added to the deck even if clicked. Filter them out by part-of-speech in the "add to deck" logic.

## FSRS

- Use `ts-fsrs` and its defaults. **Do not invent your own scheduling algorithm.**
- The four ratings are `Again` (1), `Hard` (2), `Good` (3), `Easy` (4) — match this exactly across the UI and the DB.
- Persist the full FSRS card state (`stability`, `difficulty`, `due`, `last_review`, etc.) — don't try to derive these from review history.
- After every review, append to the `reviews` table (append-only audit log) AND update `srs_state`.

## Performance expectations

- Tokenizing 500 chars: <100ms after warmup.
- Opening the lookup panel after a click: <50ms (the dictionary lookup should be a single indexed SQLite query).
- Reading view should handle pasted text up to ~5,000 characters without lag.

If you add something that might slow these down, measure it.

## Testing

- Unit tests for: tokenization helpers, FSRS wrappers, dictionary lookup, conjugation analysis.
- No need for full E2E or React component tests unless something breaks repeatedly.
- Test data: keep a `fixtures/` folder with sample Japanese sentences covering: pure hiragana, mixed kanji/kana, conjugated verbs, i-adjectives, na-adjectives, counters, and katakana loanwords.

## What NOT to do

- ❌ No cloud services, no API calls to external servers (except optionally downloading JMdict on first run).
- ❌ No analytics, telemetry, or crash reporting.
- ❌ No login system or user accounts. Single-user app.
- ❌ No "AI-powered" definitions via LLM calls. JMdict is the source of truth for meanings.
- ❌ No heavyweight UI libraries (no MUI, Ant Design, Chakra). Use **shadcn/ui** components (Tailwind + Radix under the hood) — copy them into `src/renderer/components/ui/` via the shadcn CLI as needed.
- ❌ No state management library (Redux, Zustand, etc.) until proven necessary. Start with React state and Context.
- ❌ Don't add dependencies casually. If a 5-line utility solves it, write the 5 lines.

## Working style

- **Build in the phases listed in `BUILD_SPEC.md`.** Stop and check in after each phase before continuing.
- When unsure between two approaches, ask before implementing — don't pick silently.
- When a task feels larger than expected, surface it early rather than disappearing into a long autonomous session.
- Keep this file updated. If you discover a non-obvious gotcha while working, add it to the "Japanese-specific gotchas" section.