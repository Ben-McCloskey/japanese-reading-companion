import { api } from '@platform';

export const DEFAULT_REVIEW_CAP = 20;

/**
 * `null`/missing → DEFAULT_REVIEW_CAP. `"0"` → 0 (caller treats as unlimited).
 */
export function resolveDailyCap(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_REVIEW_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_REVIEW_CAP;
  return Math.floor(n);
}

export interface DailyReviewState {
  /** YYYY-MM-DD in local time. */
  date: string;
  /** How many cards have been rated today across all synced devices. */
  done: number;
}

/** Local-date string (not UTC). Honors the user's wall-clock day boundary. */
export function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** UTC instant for the start of today in the user's local timezone. */
function localMidnightIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

/**
 * Counts every review (local + replayed from peers) since today's local
 * midnight by querying the `reviews` table. Replayers on both platforms
 * insert into that table for incoming review events, so this naturally
 * reflects cross-device totals once sync converges.
 */
export async function loadDailyReviewState(): Promise<DailyReviewState> {
  const date = todayLocalDate();
  const res = await api.getTodayReviewCount({ sinceIso: localMidnightIso() });
  const done = res.ok ? res.data.count : 0;
  return { date, done };
}
