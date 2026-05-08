import type { SrsState } from './deck';

/**
 * The persisted FSRS state row. Lives in @shared (not @main) so the iOS
 * Capacitor build can import it without pulling in better-sqlite3.
 */
export interface SrsRow {
  word_id: number;
  state: SrsState;
  due_date: string | null;
  stability: number;
  difficulty: number;
  review_count: number;
  lapse_count: number;
  last_reviewed_at: string | null;
}
