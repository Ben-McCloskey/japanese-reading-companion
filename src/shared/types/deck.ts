export type SrsState = 'new' | 'learning' | 'review' | 'lapsed' | 'known';

export interface DeckEntry {
  surface: string;       // dictionary form
  reading: string;       // hiragana reading
  state: SrsState;
  dueDate: string | null;
  reviewCount: number;
  lapseCount: number;
  jlptLevel: number | null;
  firstSentence: string | null;
}

export interface WordListItem {
  id: number;
  surface: string;
  reading: string;
  jlptLevel: number | null;
  pos: string;
  firstSentence: string | null;
  createdAt: string;
  state: SrsState;
  dueDate: string | null;
  reviewCount: number;
  lapseCount: number;
  stability: number;
  lastReviewedAt: string | null;
  seenCount: number;
}

export interface WordListFilter {
  states?: SrsState[];
  jlptLevels?: number[];
  search?: string;
}

/** Composite key for batch deck lookups: `${surface}|${reading}`. */
export type DeckKey = string;

export function deckKey(surface: string, reading: string): DeckKey {
  return `${surface}|${reading}`;
}
