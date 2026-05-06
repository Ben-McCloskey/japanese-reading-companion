import type { Database } from 'better-sqlite3';
import type { JmdictEntry } from '@shared/types/jmdict';
import type { SrsState } from '@shared/types/deck';
import type { SrsRepo } from '@main/db/repos/srs-repo';
import type { ReviewsRepo } from '@main/db/repos/reviews-repo';
import { applyRating, type FsrsRating } from '@main/services/srs/fsrs';

export interface ReviewCard {
  wordId: number;
  surface: string;
  reading: string;
  pos: string;
  jlptLevel: number | null;
  meanings: JmdictEntry[];
  firstSentence: string | null;
  state: SrsState;
  dueDate: string | null;
  reviewCount: number;
}

export interface SubmittedReview {
  wordId: number;
  newState: SrsState;
  newDueDate: string;
  intervalAfterDays: number;
}

interface ReviewDeps {
  db: Database;
  srs: SrsRepo;
  reviews: ReviewsRepo;
}

export function createReviewService(deps: ReviewDeps) {
  const submitTx = deps.db.transaction(
    (args: { wordId: number; rating: FsrsRating }): SubmittedReview => {
      const current = deps.srs.getByWord(args.wordId);
      if (!current) throw new Error(`No SRS state for word ${args.wordId}`);

      const now = new Date();
      const result = applyRating(current, args.rating, now);

      deps.srs.applyPatchSync({
        wordId: args.wordId,
        state: result.state,
        dueDate: result.due_date,
        stability: result.stability,
        difficulty: result.difficulty,
        reviewCount: result.review_count,
        lapseCount: result.lapse_count,
        lastReviewedAt: result.last_reviewed_at,
      });

      deps.reviews.log({
        word_id: args.wordId,
        rating: args.rating,
        interval_before: result.intervalBefore,
        interval_after: result.intervalAfter,
        stability_before: result.stabilityBefore,
        stability_after: result.stabilityAfter,
        reviewed_at: now.toISOString(),
      });

      return {
        wordId: args.wordId,
        newState: result.state,
        newDueDate: result.due_date,
        intervalAfterDays: result.intervalAfter,
      };
    },
  );

  return {
    queue(limit = 200): ReviewCard[] {
      const rows = deps.srs.getDueQueue(limit);
      return rows.map((r) => ({
        wordId: r.word_id,
        surface: r.surface,
        reading: r.reading,
        pos: r.pos,
        jlptLevel: r.jlpt_level,
        meanings: safeParseEntries(r.meanings_json),
        firstSentence: r.first_sentence,
        state: r.state,
        dueDate: r.due_date,
        reviewCount: r.review_count,
      }));
    },

    submit(args: { wordId: number; rating: FsrsRating }): SubmittedReview {
      return submitTx(args);
    },
  };
}

function safeParseEntries(json: string): JmdictEntry[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as JmdictEntry[];
    return [];
  } catch {
    return [];
  }
}

export type ReviewService = ReturnType<typeof createReviewService>;
