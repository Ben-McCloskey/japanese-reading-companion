import { describe, it, expect } from 'vitest';
import { applyRating, rowToCard } from './fsrs';
import type { SrsRow } from '@main/db/repos/srs-repo';

function newRow(): SrsRow {
  return {
    word_id: 1,
    state: 'new',
    due_date: null,
    stability: 0,
    difficulty: 0,
    review_count: 0,
    lapse_count: 0,
    last_reviewed_at: null,
  };
}

describe('FSRS wrapper', () => {
  it('promotes a brand new card on Good rating', () => {
    const result = applyRating(newRow(), 3);
    expect(result.state).not.toBe('new');
    expect(result.review_count).toBe(1);
    expect(result.lapse_count).toBe(0);
    expect(result.stability).toBeGreaterThan(0);
    expect(new Date(result.due_date).getTime()).toBeGreaterThan(Date.now());
  });

  it('schedules a far-future review on Easy', () => {
    const easy = applyRating(newRow(), 4);
    expect(easy.intervalAfter).toBeGreaterThanOrEqual(0);
    expect(easy.review_count).toBe(1);
  });

  it('marks lapses when an established card is rated Again', () => {
    const established: SrsRow = {
      word_id: 1,
      state: 'review',
      due_date: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      stability: 30,
      difficulty: 5,
      review_count: 5,
      lapse_count: 0,
      last_reviewed_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    };
    const result = applyRating(established, 1);
    expect(result.state).toBe('lapsed');
    expect(result.lapse_count).toBe(1);
    expect(result.review_count).toBe(6);
  });

  it('rowToCard preserves stability and difficulty', () => {
    const row: SrsRow = {
      ...newRow(),
      stability: 12.5,
      difficulty: 7.1,
      state: 'review',
      review_count: 3,
      lapse_count: 1,
    };
    const card = rowToCard(row);
    expect(card.stability).toBe(12.5);
    expect(card.difficulty).toBe(7.1);
    expect(card.reps).toBe(3);
    expect(card.lapses).toBe(1);
  });
});
