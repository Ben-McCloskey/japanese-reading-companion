import { useEffect, useState } from 'react';
import type { Token } from '@shared/types/tokenizer';
import type { JmdictEntry, JmdictExample } from '@shared/types/jmdict';
import type { DeckEntry } from '@shared/types/deck';
import { cn } from '@renderer/lib/cn';
import { katakanaToHiragana } from '@renderer/lib/kana';
import {
  isLookupSkippable,
  labelJmdictPos,
  summarizeConjugation,
} from '@renderer/lib/grammar';
import { SRS_DOT, SRS_LABEL } from '@renderer/lib/srs-style';
import { RateBar, type Rating } from './rate-bar';
import { SpeakerButton } from './speaker-button';
import { api } from '@platform';

const REVIEW_COOLDOWN_MS = 30 * 60 * 1000;

interface WordPanelProps {
  token: Token | null;
  sessionId: number | null;
  firstSentence: string | null;
  deckEntry: DeckEntry | null;
  onClose: () => void;
  onDeckChange: (key: string, entry: DeckEntry | null) => void;
}

interface PanelData {
  matchedKey: string;
  jlptLevel: number | null;
  entries: JmdictEntry[];
}

export function WordPanel({
  token,
  sessionId,
  firstSentence,
  deckEntry,
  onClose,
  onDeckChange,
}: WordPanelProps) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Close with Escape.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [token, onClose]);

  useEffect(() => {
    if (!token) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    void api
      .lookupWord({
        surface: token.surface,
        basicForm: token.basicForm,
        ...(token.reading ? { reading: token.reading } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setData(res.data);
        else setError(res.error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) return null;

  const conjugation = summarizeConjugation(token);
  const reading = token.reading ? katakanaToHiragana(token.reading) : null;
  const deckKey = `${token.basicForm}|${reading || token.basicForm}`;
  const inDeck = deckEntry !== null;

  async function onAdd(asKnown: boolean) {
    if (!data || busy || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addToDeck({
        surface: token.basicForm,
        reading: reading || token.basicForm,
        jlptLevel: data.jlptLevel,
        pos: token.pos,
        meanings: data.entries,
        sessionId,
        firstSentence,
        asKnown,
      });
      if (res.ok) onDeckChange(deckKey, res.data);
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (busy || !token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.removeFromDeck({
        surface: token.basicForm,
        reading: reading || token.basicForm,
      });
      if (res.ok) onDeckChange(deckKey, null);
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function onReview(rating: Rating) {
    if (!deckEntry || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitReview({
        wordId: deckEntry.wordId,
        rating,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Refresh the deck entry so the panel re-renders with the new state
      // (which also hides the rate bar via the due-date / cooldown checks).
      const refreshed = await api.getDeckStatesBatch({
        keys: [{ surface: deckEntry.surface, reading: deckEntry.reading }],
      });
      if (refreshed.ok) {
        onDeckChange(deckKey, refreshed.data[deckKey] ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  const canReviewInline = (() => {
    if (!deckEntry || deckEntry.state === 'known') return false;
    if (!deckEntry.dueDate) return true;
    const dueMs = new Date(deckEntry.dueDate).getTime();
    if (Number.isNaN(dueMs) || dueMs > Date.now()) return false;
    if (deckEntry.lastReviewedAt) {
      const lastMs = new Date(deckEntry.lastReviewedAt).getTime();
      if (!Number.isNaN(lastMs) && Date.now() - lastMs < REVIEW_COOLDOWN_MS) {
        return false;
      }
    }
    return true;
  })();

  return (
    <aside
      className={cn(
        'panel-enter',
        // Mobile: full-screen overlay above everything (including the bottom
        // tabs) so the user can focus on the word. Tap × to close back to
        // reading. Slides in from the right via panel-enter.
        'fixed inset-0 z-50 bg-background',
        // Desktop: side panel docked to the right of the reading view.
        'md:static md:inset-auto md:h-full md:w-[400px] md:shrink-0 md:z-auto',
        'md:border-l md:border-border/70 md:bg-surface/40',
        'flex flex-col',
      )}
    >
      <div className="title-spacer" />
      <div
        className="
          flex-1 overflow-auto
          px-5 md:px-7
          pt-2 md:pt-0
          pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] md:pb-12
        "
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              語 · word
            </div>
            <div className="font-display text-4xl tracking-tighter text-foreground leading-none break-words">
              {data?.matchedKey ?? token.basicForm ?? token.surface}
            </div>
            <div className="mt-2 flex items-center gap-3">
              {reading ? (
                <div className="text-base text-muted-foreground">{reading}</div>
              ) : null}
              <SpeakerButton
                text={data?.matchedKey ?? token.basicForm ?? token.surface}
                size="sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {data?.jlptLevel ? (
              <span
                className="
                  inline-flex items-center text-[10px] tracking-widest
                  px-2 py-0.5 rounded-full
                  bg-accent/15 text-accent border border-accent/30
                "
                aria-label={`JLPT N${data.jlptLevel}`}
              >
                N{data.jlptLevel}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="
                text-muted-foreground hover:text-foreground
                transition-[color,transform] duration-150 ease-out-strong
                active:scale-[0.92]
                text-xl leading-none px-1.5 py-0.5 rounded-md
                focus-visible:outline-none focus-visible:bg-muted/40
              "
            >
              ×
            </button>
          </div>
        </div>

        {/* Grammar / inflection summary */}
        <div className="mt-7 text-sm space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-20 shrink-0">
              part
            </span>
            <span className="text-foreground/90">{conjugation.posLabel}</span>
          </div>
          {conjugation.conjTypeLabel ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-20 shrink-0">
                class
              </span>
              <span className="text-foreground/90">
                {conjugation.conjTypeLabel}
              </span>
            </div>
          ) : null}
          {conjugation.isInflected ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-20 shrink-0">
                form
              </span>
              <span className="text-foreground/90">
                {token.surface}
                <span className="text-muted-foreground"> → </span>
                {token.basicForm}
                {conjugation.conjFormLabel ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {conjugation.conjFormLabel}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>

        <div className="my-7 h-px bg-border/60" />

        {/* Definitions */}
        {loading ? (
          <SkeletonDefinitions />
        ) : error ? (
          <div
            role="alert"
            className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
          >
            {error}
          </div>
        ) : !data ? (
          <NotFound query={token.basicForm} />
        ) : (
          <Definitions entries={data.entries} />
        )}

        {/* Deck actions / status */}
        {data && !error ? (
          <div className="mt-9 pt-6 border-t border-border/60">
            {inDeck && deckEntry ? (
              <>
                <DeckStatusRow
                  entry={deckEntry}
                  busy={busy}
                  onRemove={onRemove}
                />
                {canReviewInline ? (
                  <InlineReview busy={busy} onReview={onReview} />
                ) : null}
              </>
            ) : (
              <DeckActions busy={busy} onAdd={onAdd} />
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function DeckActions({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (asKnown: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd(false)}
          className="
            flex-1 inline-flex items-center justify-center
            bg-foreground text-background text-sm tracking-wide
            px-4 py-2.5 rounded-md
            transition-[transform,opacity] duration-150 ease-out-strong
            active:scale-[0.97]
            disabled:opacity-60 disabled:cursor-not-allowed
          "
        >
          {busy ? 'Adding…' : 'Add to deck'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd(true)}
          className="
            inline-flex items-center justify-center
            border border-border text-foreground/80 text-sm tracking-wide
            px-4 py-2.5 rounded-md
            transition-[transform,background-color,color] duration-150 ease-out-strong
            hover:bg-muted/40 hover:text-foreground
            active:scale-[0.97]
            disabled:opacity-60 disabled:cursor-not-allowed
          "
          title="Add and skip the learning phase"
        >
          Mark as known
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground/80 leading-relaxed">
        Adds <span className="text-foreground/70">dictionary form</span> with
        the source sentence captured for review.
      </div>
    </div>
  );
}

function DeckStatusRow({
  entry,
  busy,
  onRemove,
}: {
  entry: DeckEntry;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm">
          <span
            className={cn('inline-block h-2 w-2 rounded-full', SRS_DOT[entry.state])}
            aria-hidden
          />
          <span className="text-foreground/90 capitalize">
            {SRS_LABEL[entry.state]}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground tabular-nums">
            {entry.reviewCount} review{entry.reviewCount === 1 ? '' : 's'}
          </span>
        </div>
        {entry.dueDate && entry.state !== 'known' ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            due {formatDue(entry.dueDate)}
          </span>
        ) : null}
      </div>
      {entry.firstSentence ? (
        <div className="text-xs text-muted-foreground italic border-l-2 border-border/60 pl-3 line-clamp-2">
          {entry.firstSentence}
        </div>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="
            text-xs tracking-wide text-muted-foreground
            hover:text-accent transition-colors duration-150
            disabled:opacity-60
          "
        >
          {busy ? 'Removing…' : 'Remove from deck'}
        </button>
      </div>
    </div>
  );
}

function InlineReview({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: (r: Rating) => void;
}) {
  return (
    <div className="mt-5 pt-5 border-t border-border/40">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-2.5">
        review · optional
      </div>
      <RateBar onRate={onReview} busy={busy} size="compact" />
    </div>
  );
}

function formatDue(iso: string): string {
  // Date-only string from main: "YYYY-MM-DD"
  if (!iso) return '';
  if (iso.startsWith('9999')) return 'never';
  const today = new Date().toISOString().slice(0, 10);
  if (iso <= today) return 'today';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const diffDays = Math.round(
    (d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000,
  );
  if (diffDays === 1) return 'tomorrow';
  if (diffDays < 7) return `in ${diffDays}d`;
  return iso;
}

function Definitions({ entries }: { entries: JmdictEntry[] }) {
  return (
    <div className="space-y-7">
      {entries.map((entry, ei) => (
        <div key={entry.entSeq}>
          {entries.length > 1 ? (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              entry {ei + 1}
            </div>
          ) : null}
          <ol className="space-y-4">
            {entry.senses.map((sense, si) => (
              <li key={si} className="text-sm leading-relaxed">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-muted-foreground tabular-nums w-5 shrink-0 text-right">
                    {si + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    {sense.pos.length > 0 ? (
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/80 mb-1">
                        {sense.pos.map(labelJmdictPos).join(' · ')}
                      </div>
                    ) : null}
                    <div className="text-foreground/90">
                      {sense.glosses.join('; ')}
                    </div>
                    {sense.examples && sense.examples.length > 0 ? (
                      <ExampleList examples={sense.examples.slice(0, 2)} />
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function ExampleList({ examples }: { examples: JmdictExample[] }) {
  return (
    <div className="mt-3 space-y-2 border-l-2 border-border/60 pl-4">
      {examples.map((ex, i) => (
        <div key={i} className="text-sm">
          <div className="font-sans text-foreground/80">{ex.japanese}</div>
          {ex.translations.length > 0 ? (
            <div className="text-xs text-muted-foreground italic mt-0.5">
              {ex.translations[0]}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NotFound({ query }: { query: string }) {
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <div>
        No JMdict entry for{' '}
        <span className="font-display text-foreground/80">{query}</span>.
      </div>
      <div className="text-xs">
        This often happens for proper nouns, numbers, or compounds the
        tokenizer split aggressively. Try selecting a related word.
      </div>
    </div>
  );
}

function SkeletonDefinitions() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 w-1/2 bg-muted/60 rounded" />
      <div className="h-3 w-3/4 bg-muted/60 rounded" />
      <div className="h-3 w-2/3 bg-muted/60 rounded" />
    </div>
  );
}

export { isLookupSkippable };
