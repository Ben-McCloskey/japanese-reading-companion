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

  return {
    log(entry: ReviewLogInsert): void {
      insert.run(entry);
    },
  };
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>;
