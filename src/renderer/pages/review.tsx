import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { SpeakerButton } from '@renderer/components/speaker-button';
import { RateBar, type Rating } from '@renderer/components/rate-bar';
import { cn } from '@renderer/lib/cn';
import { labelJmdictPos } from '@renderer/lib/grammar';
import {
  loadDailyReviewState,
  persistDailyReviewState,
  resolveDailyCap,
  todayLocalDate,
  type DailyReviewState,
} from '@renderer/lib/daily-review';
import { api } from '@platform';
import type { ReviewCardDto } from '@shared/ipc';
import type { JmdictEntry } from '@shared/types/jmdict';

export function ReviewPage() {
  const [queue, setQueue] = useState<ReviewCardDto[] | null>(null);
  const [daily, setDaily] = useState<DailyReviewState>({
    date: todayLocalDate(),
    done: 0,
  });
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    const [queueRes, capRes, dailyState] = await Promise.all([
      api.getReviewQueue(),
      api.getSetting('dailyReviewCap'),
      loadDailyReviewState(),
    ]);
    if (!queueRes.ok) {
      setError(queueRes.error);
      return;
    }
    let cards = queueRes.data;
    const cap = resolveDailyCap(capRes.ok ? capRes.data : null);
    if (cap > 0) {
      const remaining = Math.max(0, cap - dailyState.done);
      cards = cards.slice(0, remaining);
    }
    setDaily(dailyState);
    setQueue(cards);
    setFlipped(false);
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const current = queue?.[0] ?? null;

  const onRate = useCallback(
    async (rating: Rating) => {
      if (!current || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.submitReview({
          wordId: current.wordId,
          rating,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setQueue((prev) => (prev ? prev.slice(1) : prev));
        const next: DailyReviewState = {
          date: todayLocalDate(),
          done:
            daily.date === todayLocalDate() ? daily.done + 1 : 1,
        };
        setDaily(next);
        void persistDailyReviewState(next);
        setFlipped(false);
      } finally {
        setBusy(false);
      }
    },
    [current, busy, daily],
  );

  // Keyboard: space flips, 1/2/3/4 rate
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (busy) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setFlipped(true);
        return;
      }
      if (flipped && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        e.preventDefault();
        void onRate(Number(e.key) as Rating);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, flipped, busy, onRate]);

  const totalDue = (queue?.length ?? 0) + daily.done;
  const left = queue?.length ?? 0;

  return (
    <PageShell
      eyebrow="復 · review"
      title="Review"
      subtitle="Recall the reading and meaning. Press space to flip."
    >
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
        >
          {error}
        </div>
      ) : null}

      {queue === null ? (
        <CardSkeleton />
      ) : current ? (
        <>
          <Counter total={totalDue} done={daily.done} left={left} />
          <ReviewCard
            card={current}
            flipped={flipped}
            onFlip={() => setFlipped(true)}
            onRate={onRate}
            busy={busy}
          />
        </>
      ) : (
        <EmptyState onRefresh={loadQueue} done={daily.done} />
      )}
    </PageShell>
  );
}

function Counter({
  total,
  done,
  left,
}: {
  total: number;
  done: number;
  left: number;
}) {
  return (
    <div className="flex items-center justify-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums mb-5 md:mb-8">
      <span>{total} due</span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-foreground/80">{done} done</span>
      <span className="text-muted-foreground/40">·</span>
      <span>{left} left</span>
    </div>
  );
}

function ReviewCard({
  card,
  flipped,
  onFlip,
  onRate,
  busy,
}: {
  card: ReviewCardDto;
  flipped: boolean;
  onFlip: () => void;
  onRate: (r: Rating) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-5 md:space-y-8">
      <article
        key={`${card.wordId}-${flipped ? 'back' : 'front'}`}
        className={cn(
          'fade-rise',
          'rounded-xl border border-border/60 bg-surface/40',
          // Mobile: more compact so the rate bar lands in thumb reach
          // without scrolling. Desktop keeps the generous "card on a wall"
          // proportions.
          'px-6 py-9 min-h-[280px] md:px-12 md:py-16 md:min-h-[420px]',
          'flex flex-col items-center justify-center text-center',
          !flipped && 'cursor-pointer select-none',
        )}
        onClick={() => {
          if (!flipped) onFlip();
        }}
      >
        {flipped ? <CardBack card={card} /> : <CardFront card={card} />}
      </article>

      {flipped ? (
        <RateBar onRate={onRate} busy={busy} />
      ) : (
        <div className="text-center text-[11px] uppercase tracking-widest text-muted-foreground/70">
          {/* On touch devices the keyboard hint is meaningless. */}
          <span className="hidden md:inline">
            press <kbd className="px-1 py-0.5 rounded bg-muted/40 text-foreground/80">space</kbd> to flip
          </span>
          <span className="md:hidden">tap card to flip</span>
        </div>
      )}
    </div>
  );
}

function CardFront({ card }: { card: ReviewCardDto }) {
  return (
    <div className="space-y-7 md:space-y-12 max-w-xl">
      <div className="font-display text-5xl md:text-7xl tracking-tighter text-foreground leading-none break-words">
        {card.surface}
      </div>
      {card.firstSentence ? (
        <div className="text-sm md:text-base text-muted-foreground italic leading-relaxed">
          “{card.firstSentence}”
        </div>
      ) : null}
    </div>
  );
}

function CardBack({ card }: { card: ReviewCardDto }) {
  return (
    <div className="space-y-6 md:space-y-8 max-w-xl">
      <div>
        <div className="font-display text-4xl md:text-6xl tracking-tighter text-foreground leading-none break-words">
          {card.surface}
        </div>
        <div className="mt-3 flex items-center justify-center gap-3">
          <span className="font-sans text-xl text-muted-foreground tracking-wide">
            {card.reading}
          </span>
          <SpeakerButton text={card.surface} size="sm" />
        </div>
        {card.jlptLevel ? (
          <div className="mt-4">
            <span className="inline-flex items-center text-[10px] tracking-widest px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
              N{card.jlptLevel}
            </span>
          </div>
        ) : null}
      </div>

      <div className="h-px w-16 bg-border/60 mx-auto" />

      <Definitions entries={card.meanings} />

      {card.firstSentence ? (
        <>
          <div className="h-px w-16 bg-border/60 mx-auto" />
          <div className="text-sm text-muted-foreground italic leading-relaxed">
            “{card.firstSentence}”
          </div>
        </>
      ) : null}
    </div>
  );
}

function Definitions({ entries }: { entries: JmdictEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No meanings captured for this word.
      </div>
    );
  }
  // Show all senses from the first entry only — cleaner card.
  const first = entries[0];
  if (!first) return null;
  return (
    <ol className="space-y-3 text-left max-w-md mx-auto">
      {first.senses.slice(0, 4).map((sense, i) => (
        <li key={i} className="text-sm leading-relaxed">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-muted-foreground tabular-nums w-5 shrink-0 text-right">
              {i + 1}.
            </span>
            <div className="flex-1 min-w-0">
              {sense.pos.length > 0 ? (
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground/80 mb-0.5">
                  {sense.pos.map(labelJmdictPos).join(' · ')}
                </div>
              ) : null}
              <div className="text-foreground/90">
                {sense.glosses.join('; ')}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-5 md:space-y-8 animate-pulse">
      <div className="h-3 w-24 bg-muted/40 rounded mx-auto" />
      <div className="rounded-xl border border-border/60 bg-surface/30 px-6 py-9 min-h-[280px] md:px-12 md:py-16 md:min-h-[420px]" />
    </div>
  );
}

function EmptyState({
  onRefresh,
  done,
}: {
  onRefresh: () => void;
  done: number;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-surface/30 px-10 py-14 text-center">
      <div className="font-display text-3xl tracking-tighter text-foreground mb-3">
        {done > 0 ? 'All done.' : 'Nothing to review.'}
      </div>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        {done > 0
          ? `You finished ${done} review${done === 1 ? '' : 's'}. Come back tomorrow — or go read something and add new words.`
          : 'Open the Read tab, paste some Japanese, and add a few words to your deck.'}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        className="
          mt-7 inline-flex items-center gap-2
          text-xs tracking-widest uppercase text-muted-foreground
          hover:text-foreground transition-colors duration-150
        "
      >
        refresh
      </button>
    </div>
  );
}
