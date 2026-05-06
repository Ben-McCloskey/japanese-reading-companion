# Japanese Reading Companion — Build Spec

## What I want
I receive a lot of Japanese messages every day for work. I'm fluent at speaking Japanese but weak at reading kanji, so right now I copy/paste everything into Google Translate just to read it. I want to replace that workflow with a desktop app that:

1. Lets me paste Japanese text and instantly shows it back to me with **furigana** over the kanji so I can read it.
2. Lets me **click any word** for its meaning, reading, grammar info, and a TTS pronunciation.
3. Quietly tracks every word I encounter and builds a personal **SRS flashcard deck** (like Anki) from my actual reading, so the words I review every night are the ones I'm really seeing in my work.

The goal is a tool I open every day that turns my real incoming messages into both a reading aid AND my study material. No cloud, no accounts, just a fast local app for me.

## Tech stack
- **Framework**: Electron + React + TypeScript + Vite (use the `electron-vite` scaffold or equivalent)
- **Styling**: Tailwind CSS + shadcn/ui (copy components in via the shadcn CLI as needed)
- **Tokenizer**: `kuromoji` (kuromoji.js) for Japanese morphological analysis — runs in-process, no external MeCab needed
- **Dictionary**: JMdict (the standard free Japanese-English dictionary) — download the JMdict_e file, parse on first run, store in SQLite
- **Database**: SQLite via `better-sqlite3` (synchronous, fast, perfect for a single-user desktop app)
- **SRS algorithm**: FSRS via the `ts-fsrs` npm package (modern, more accurate than SM-2)
- **TTS**: Web Speech API using the OS's Japanese voice — no API key needed
- **Optional example sentences**: Tatoeba sentence pairs (downloadable CSV) if easy to integrate; otherwise just use JMdict's example fields

## Core features

### 1. Reading view (the main screen)
- Big textarea at the top where I paste Japanese text
- "Process" button + `Cmd/Ctrl+Enter` shortcut
- Below the input, render the tokenized text with HTML `<ruby>` tags so furigana sits above kanji compounds. Kana words render as-is.
- Each word is a clickable span. Hover state is subtle.
- **Color-code words by SRS status** so I can see at a glance what I know:
  - Gray = unseen / not in deck
  - Blue = learning (in deck, still maturing)
  - Green = known (mature, high stability)
  - Red = lapsed (failed recently)
- Furigana is small, gray, and never overpowers the main text. Use a clean Japanese font (Noto Sans JP or Hiragino Sans).

### 2. Word lookup panel
When I click a word, open a side panel (or popover) showing:
- The word in kanji + its reading
- **JLPT level** badge (N5–N1) if known
- **Part of speech** (noun, godan verb, i-adjective, etc.)
- All English meanings from JMdict, grouped by sense
- **Grammar/conjugation breakdown** if it's a verb or adjective: show the dictionary form, conjugation class, and what form the original token was in (e.g., "食べました → 食べる, godan? no — ichidan verb, polite past")
- 1–3 **example sentences** from JMdict (or Tatoeba)
- A 🔊 **play button** that uses Web Speech API to pronounce the word in Japanese
- Action buttons:
  - "Add to deck" (if not yet tracked)
  - "Mark as known" (skip learning phase, treat as already mature)
  - If already in deck: show current SRS status, due date, and review count

### 3. Review (flashcards)
- Dedicated "Review" screen accessible from the sidebar
- Shows due cards in FSRS order
- **Card front**: the word in kanji (no furigana), shown alongside the original sentence I first encountered it in (for context — this is the killer feature vs. plain Anki)
- Tap or press space to flip → reveals reading, meanings, grammar info, and a 🔊 button
- Four rating buttons: **Again / Hard / Good / Easy** (mapped to keys `1` / `2` / `3` / `4`)
- Updates FSRS state and reschedules
- Header counter: "23 due · 5 done · 18 left"
- Empty state when nothing is due: "Nothing to review — go read something!"

### 4. Reading sessions
- Every pasted text is saved as a "session" with timestamp and an auto-generated title (first ~30 characters)
- Sessions list view: date, preview snippet, stats (total words, new words this session)
- Click a session to re-open it with current word states applied (so a word I now know will show green)
- Allow deleting sessions

### 5. My Words (deck management)
- Searchable, filterable list of every word I've added
- Filter by status (new / learning / known / lapsed) and JLPT level
- Per-word stats: times seen across sessions, current FSRS stability, last reviewed, source session
- Bulk actions: mark as known, suspend, delete

## Data model

```
sessions
  id, created_at, title, raw_text, processed_tokens_json

words
  id, surface (dictionary form), reading, jlpt_level, pos, meanings_json,
  example_sentences_json, created_at, first_session_id, first_sentence

srs_state (one row per word)
  word_id, state ('new'|'learning'|'review'|'lapsed'|'known'),
  due_date, stability, difficulty, review_count, lapse_count, last_reviewed_at

reviews (history log, append-only)
  id, word_id, reviewed_at, rating (1-4), interval_before, interval_after,
  stability_before, stability_after

settings
  key, value  (for things like dark mode, daily review cap, FSRS params)
```

## UI/UX requirements
- **Calm, minimal design** — this is a daily-use tool, not a demo. Lots of whitespace.
- **Dark mode** with a toggle in settings (persists across launches)
- **Layout**: left sidebar nav (Read · Review · Sessions · Words · Settings), main content on the right
- **Keyboard shortcuts**:
  - `Cmd/Ctrl+Enter`: process text in Reading view
  - `Esc`: close lookup panel
  - `Space`: flip flashcard
  - `1` / `2` / `3` / `4`: rate flashcard
  - `Cmd/Ctrl+1..5`: switch sidebar sections
- Performance: tokenizing a 500-character message should feel instant after warmup

## First-run experience
On first launch:
1. Download (or load from a bundled file) JMdict and parse it into SQLite. Show a progress bar — this can take a minute.
2. Initialize default FSRS parameters and SQLite schema.
3. Land on the Reading view with a friendly empty state and an example I can try.

## Build in phases — stop and check in after each
Please build this in clear, testable phases. After each phase, summarize what works, what's stubbed, and let me try it before moving on.

- **Phase 1** — Electron + React + TS skeleton, sidebar nav, Tailwind set up, SQLite initialized, dark mode toggle.
- **Phase 2** — JMdict parser → SQLite, kuromoji integration, basic tokenization test.
- **Phase 3** — Reading view: paste text, render with furigana, click a word to open the lookup panel with definition + grammar + JLPT + examples.
- **Phase 4** — Save sessions, save clicked words to deck, persist across launches.
- **Phase 5** — FSRS scheduling and the Review screen with the source-sentence-as-context feature.
- **Phase 6** — My Words view with filters and bulk actions; Sessions list view.
- **Phase 7** — TTS, keyboard shortcuts, polish, settings page, packaging for distribution.

## Quality bar
- One-command setup: `npm install && npm run dev` for dev, `npm run build` for a packaged app.
- Include a README with setup instructions and where JMdict is downloaded from.
- TypeScript **strict mode** on. No `any` unless justified by a comment.
- Small, focused components. Business logic separated from UI (e.g., FSRS logic in its own module).
- Errors are surfaced to me with a toast or inline message — never silently swallowed.
- Don't store anything outside SQLite + Electron's userData directory.

## What I do NOT want
- No cloud sync, accounts, or login
- No mobile or web deployment
- No analytics or telemetry
- No unnecessary dependencies — prefer the standard library and small, well-maintained packages

## Before you start
If anything in this spec is ambiguous or you'd recommend a different approach for a specific piece, ask me before going deep. I'd rather discuss tradeoffs early than rebuild later.