import type { Token } from '@shared/types/tokenizer';
import type { SessionsRepo } from '@main/db/repos/sessions-repo';
import type { WordsRepo } from '@main/db/repos/words-repo';
import type { AppearancesRepo } from '@main/db/repos/appearances-repo';

function katakanaToHiragana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60);
    else out += s.charAt(i);
  }
  return out;
}

interface Deps {
  sessions: SessionsRepo;
  words: WordsRepo;
  appearances: AppearancesRepo;
}

export function createAppearancesService(deps: Deps) {
  function tally(tokens: Token[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const t of tokens) {
      if (!t.basicForm) continue;
      const reading = t.reading ? katakanaToHiragana(t.reading) : t.basicForm;
      const key = `${t.basicForm}|${reading}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }

  function syncForSession(sessionId: number, tokens: Token[]): void {
    const counts = new Map<number, number>();
    for (const [key, count] of tally(tokens)) {
      const idx = key.indexOf('|');
      const surface = key.slice(0, idx);
      const reading = key.slice(idx + 1);
      const word = deps.words.getByKey(surface, reading);
      if (word) counts.set(word.id, count);
    }
    deps.appearances.setForSession(sessionId, counts);
  }

  /**
   * After a new word enters the deck, scan every saved session and tally how
   * often the word's dictionary form appears. Writes one row per session that
   * contains the word.
   */
  function syncForNewWord(
    wordId: number,
    surface: string,
    reading: string,
  ): void {
    const summaries = deps.sessions.list();
    const perSession = new Map<number, number>();
    for (const summary of summaries) {
      const row = deps.sessions.get(summary.id);
      if (!row) continue;
      let tokens: Token[];
      try {
        const parsed: unknown = JSON.parse(row.processed_tokens_json);
        tokens = Array.isArray(parsed) ? (parsed as Token[]) : [];
      } catch {
        continue;
      }
      let count = 0;
      for (const t of tokens) {
        if (!t.basicForm) continue;
        const tReading = t.reading
          ? katakanaToHiragana(t.reading)
          : t.basicForm;
        if (t.basicForm === surface && tReading === reading) count += 1;
      }
      if (count > 0) perSession.set(summary.id, count);
    }
    deps.appearances.setForWord(wordId, perSession);
  }

  return { syncForSession, syncForNewWord };
}

export type AppearancesService = ReturnType<typeof createAppearancesService>;
