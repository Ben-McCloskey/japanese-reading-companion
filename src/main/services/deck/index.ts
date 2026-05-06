import type { JmdictEntry } from '@shared/types/jmdict';
import type { DeckEntry, SrsState } from '@shared/types/deck';
import type { WordsRepo } from '@main/db/repos/words-repo';
import type { SrsRepo, SrsKeyedRow } from '@main/db/repos/srs-repo';
import type { AppearancesService } from '@main/services/appearances';

export interface DeckAddArgs {
  surface: string;       // dictionary form
  reading: string;       // hiragana
  jlptLevel: number | null;
  pos: string;
  meanings: JmdictEntry[];
  firstSessionId: number | null;
  firstSentence: string | null;
  asKnown?: boolean;
}

interface DeckDeps {
  words: WordsRepo;
  srs: SrsRepo;
  appearances?: AppearancesService;
}

function rowToEntry(row: SrsKeyedRow): DeckEntry {
  return {
    surface: row.surface,
    reading: row.reading,
    state: row.state as SrsState,
    dueDate: row.due_date,
    reviewCount: row.review_count,
    lapseCount: row.lapse_count,
    jlptLevel: row.jlpt_level,
    firstSentence: row.first_sentence,
  };
}

export function createDeckService(deps: DeckDeps) {
  return {
    addWord(args: DeckAddArgs): DeckEntry {
      // Pull example sentences out of JMdict entries (if any).
      const examples: { japanese: string; translation?: string }[] = [];
      for (const entry of args.meanings) {
        for (const sense of entry.senses) {
          if (!sense.examples) continue;
          for (const ex of sense.examples) {
            examples.push({
              japanese: ex.japanese,
              ...(ex.translations[0] ? { translation: ex.translations[0] } : {}),
            });
          }
        }
      }

      const word = deps.words.upsert({
        surface: args.surface,
        reading: args.reading,
        jlptLevel: args.jlptLevel,
        pos: args.pos,
        meaningsJson: JSON.stringify(args.meanings),
        exampleSentencesJson:
          examples.length > 0 ? JSON.stringify(examples) : null,
        firstSessionId: args.firstSessionId,
        firstSentence: args.firstSentence,
      });

      if (args.asKnown) {
        deps.srs.markKnown(word.id);
      } else {
        // Only set 'new' state if there isn't already SRS state for this word.
        // Re-adding a word in active review shouldn't reset its state.
        const existing = deps.srs.getByWord(word.id);
        if (!existing) deps.srs.markNew(word.id);
      }

      const row = deps.srs.getForKey(args.surface, args.reading);
      if (!row) throw new Error('SRS state was not created');

      // Backfill appearance counts across every saved session so the new
      // word starts life with accurate "times seen" stats.
      deps.appearances?.syncForNewWord(word.id, args.surface, args.reading);

      return rowToEntry(row);
    },

    removeWord(surface: string, reading: string): void {
      const word = deps.words.getByKey(surface, reading);
      if (!word) return;
      // Cascade removes srs_state via the FK; reviews go too. Sessions stay.
      deps.words.remove(word.id);
    },

    state(surface: string, reading: string): DeckEntry | null {
      const row = deps.srs.getForKey(surface, reading);
      return row ? rowToEntry(row) : null;
    },

    statesBatch(
      keys: Array<{ surface: string; reading: string }>,
    ): Record<string, DeckEntry> {
      const out: Record<string, DeckEntry> = {};
      for (const row of deps.srs.getForKeys(keys)) {
        out[`${row.surface}|${row.reading}`] = rowToEntry(row);
      }
      return out;
    },
  };
}

export type DeckService = ReturnType<typeof createDeckService>;
