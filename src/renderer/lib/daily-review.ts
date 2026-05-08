import { api } from '@platform';

const DATE_KEY = 'reviewsDoneDate';
const COUNT_KEY = 'reviewsDoneCount';

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
  /** How many cards have been rated today. */
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

/**
 * Load the persisted "reviews done today" counter. If the persisted date is
 * older than today, returns a fresh state for today. Caller is responsible
 * for persisting the new state on first rating.
 */
export async function loadDailyReviewState(): Promise<DailyReviewState> {
  const today = todayLocalDate();
  const [dateRes, countRes] = await Promise.all([
    api.getSetting(DATE_KEY),
    api.getSetting(COUNT_KEY),
  ]);
  const storedDate = dateRes.ok && dateRes.data ? dateRes.data : null;
  if (storedDate !== today) return { date: today, done: 0 };
  const raw = countRes.ok && countRes.data ? Number(countRes.data) : 0;
  return { date: today, done: Number.isFinite(raw) ? raw : 0 };
}

export async function persistDailyReviewState(
  state: DailyReviewState,
): Promise<void> {
  await Promise.all([
    api.setSetting(DATE_KEY, state.date),
    api.setSetting(COUNT_KEY, String(state.done)),
  ]);
}
