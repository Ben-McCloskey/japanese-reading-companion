import {
  fsrs as makeFsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type { SrsState } from '@shared/types/deck';
import type { SrsRow } from '@main/db/repos/srs-repo';

const scheduler = makeFsrs(generatorParameters());

const STATE_TO_INTERNAL: Record<State, Exclude<SrsState, 'known'>> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'lapsed',
};

const INTERNAL_TO_STATE: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  lapsed: State.Relearning,
  // 'known' is outside FSRS — words flagged as known never enter the queue.
  known: State.Review,
};

export type FsrsRating = 1 | 2 | 3 | 4;

const RATING_BY_GRADE: Record<FsrsRating, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

export function rowToCard(row: SrsRow): Card {
  const due = row.due_date ? new Date(row.due_date) : new Date();
  const last = row.last_reviewed_at ? new Date(row.last_reviewed_at) : undefined;
  return {
    due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: row.review_count,
    lapses: row.lapse_count,
    state: INTERNAL_TO_STATE[row.state],
    ...(last ? { last_review: last } : {}),
  };
}

export interface AppliedRating {
  state: SrsState;
  due_date: string;
  stability: number;
  difficulty: number;
  review_count: number;
  lapse_count: number;
  last_reviewed_at: string;
  /** Days between last_review and previous due, snapped to integer. */
  intervalBefore: number | null;
  /** Days between now and the new due. */
  intervalAfter: number;
  stabilityBefore: number;
  stabilityAfter: number;
}

export function applyRating(
  current: SrsRow,
  rating: FsrsRating,
  now: Date = new Date(),
): AppliedRating {
  const card = rowToCard(current);
  const result = scheduler.next(card, now, RATING_BY_GRADE[rating]);
  const next = result.card;

  const intervalBefore = current.last_reviewed_at && current.due_date
    ? Math.max(
        0,
        Math.round(
          (new Date(current.due_date).getTime() -
            new Date(current.last_reviewed_at).getTime()) /
            86_400_000,
        ),
      )
    : null;

  const intervalAfter = Math.max(
    0,
    Math.round((next.due.getTime() - now.getTime()) / 86_400_000),
  );

  return {
    state: STATE_TO_INTERNAL[next.state],
    due_date: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    review_count: next.reps,
    lapse_count: next.lapses,
    last_reviewed_at: (next.last_review ?? now).toISOString(),
    intervalBefore,
    intervalAfter,
    stabilityBefore: current.stability,
    stabilityAfter: next.stability,
  };
}
