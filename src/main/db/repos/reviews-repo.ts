import type { Database } from 'better-sqlite3';

export interface ReviewLogInsert {
  word_id: number;
  rating: 1 | 2 | 3 | 4;
  interval_before: number | null;
  interval_after: number;
  stability_before: number;
  stability_after: number;
  reviewed_at: string;
}

export function createReviewsRepo(db: Database) {
  const insert = db.prepare<ReviewLogInsert>(
    `INSERT INTO reviews (
       word_id, reviewed_at, rating,
       interval_before, interval_after,
       stability_before, stability_after
     ) VALUES (
       @word_id, @reviewed_at, @rating,
       @interval_before, @interval_after,
       @stability_before, @stability_after
     )`,
  );

  const countSinceStmt = db.prepare<{ since: string }, { n: number }>(
    'SELECT COUNT(*) AS n FROM reviews WHERE reviewed_at >= @since',
  );

  return {
    log(entry: ReviewLogInsert): void {
      insert.run(entry);
    },
    countSince(iso: string): number {
      return countSinceStmt.get({ since: iso })?.n ?? 0;
    },
  };
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>;
