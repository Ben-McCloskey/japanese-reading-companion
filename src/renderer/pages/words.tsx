import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { cn } from '@renderer/lib/cn';
import { SRS_DOT, SRS_LABEL } from '@renderer/lib/srs-style';
import type { SrsState, WordListFilter, WordListItem } from '@shared/types/deck';

const ALL_STATES: SrsState[] = ['new', 'learning', 'review', 'lapsed', 'known'];
const ALL_LEVELS = [5, 4, 3, 2, 1] as const;

export function WordsPage() {
  const [items, setItems] = useState<WordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WordListFilter>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async (f: WordListFilter) => {
    setLoading(true);
    setError(null);
    const res = await window.api.listWords(f);
    if (res.ok) {
      setItems(res.data);
      // Drop selections that aren't in the new list.
      setSelected((prev) => {
        const next = new Set<number>();
        for (const it of res.data) if (prev.has(it.id)) next.add(it.id);
        return next;
      });
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  function toggleState(s: SrsState) {
    setFilter((f) => {
      const cur = new Set(f.states ?? []);
      if (cur.has(s)) cur.delete(s);
      else cur.add(s);
      return { ...f, states: Array.from(cur) };
    });
  }

  function toggleLevel(l: number) {
    setFilter((f) => {
      const cur = new Set(f.jlptLevels ?? []);
      if (cur.has(l)) cur.delete(l);
      else cur.add(l);
      return { ...f, jlptLevels: Array.from(cur) };
    });
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkMarkKnown() {
    if (selected.size === 0) return;
    const res = await window.api.bulkMarkWordsKnown({
      ids: Array.from(selected),
    });
    if (res.ok) {
      setSelected(new Set());
      void load(filter);
    } else {
      setError(res.error);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    const res = await window.api.bulkDeleteWords({
      ids: Array.from(selected),
    });
    if (res.ok) {
      setSelected(new Set());
      void load(filter);
    } else {
      setError(res.error);
    }
  }

  const counts = useMemo(() => {
    const c: Record<SrsState, number> = {
      new: 0,
      learning: 0,
      review: 0,
      lapsed: 0,
      known: 0,
    };
    for (const it of items) c[it.state] = (c[it.state] ?? 0) + 1;
    return c;
  }, [items]);

  return (
    <PageShell
      eyebrow="語 · words"
      title="My Words"
      subtitle="Every word you've added. Filter, search, and clean up your deck."
    >
      <div className="space-y-6">
        <FilterBar
          filter={filter}
          onSearchChange={(s) => setFilter((f) => ({ ...f, search: s }))}
          onToggleState={toggleState}
          onToggleLevel={toggleLevel}
          onClear={() => setFilter({})}
          counts={counts}
          total={items.length}
        />

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
          >
            {error}
          </div>
        ) : null}

        {selected.size > 0 ? (
          <BulkBar
            count={selected.size}
            onMarkKnown={bulkMarkKnown}
            onDelete={bulkDelete}
            onClear={() => setSelected(new Set())}
          />
        ) : null}

        {loading ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState filtered={hasActiveFilter(filter)} />
        ) : (
          <div className="rounded-md border border-border/60 overflow-hidden">
            <HeaderRow allSelected={allSelected} onToggleAll={toggleAll} />
            <ul className="divide-y divide-border/50">
              {items.map((w) => (
                <Row
                  key={w.id}
                  word={w}
                  selected={selected.has(w.id)}
                  onToggle={() => toggleOne(w.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function hasActiveFilter(f: WordListFilter): boolean {
  return (
    !!(f.search && f.search.trim()) ||
    (f.states?.length ?? 0) > 0 ||
    (f.jlptLevels?.length ?? 0) > 0
  );
}

function FilterBar({
  filter,
  onSearchChange,
  onToggleState,
  onToggleLevel,
  onClear,
  counts,
  total,
}: {
  filter: WordListFilter;
  onSearchChange: (s: string) => void;
  onToggleState: (s: SrsState) => void;
  onToggleLevel: (l: number) => void;
  onClear: () => void;
  counts: Record<SrsState, number>;
  total: number;
}) {
  const activeStates = new Set(filter.states ?? []);
  const activeLevels = new Set(filter.jlptLevels ?? []);
  const showClear = hasActiveFilter(filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="search"
          value={filter.search ?? ''}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="search by surface or reading…"
          spellCheck={false}
          className="
            flex-1 max-w-sm
            bg-surface/40 border border-border/70 rounded-md
            px-3 py-2 text-sm text-foreground
            placeholder:text-muted-foreground
            focus:outline-none focus:border-foreground/40
            transition-colors duration-150
          "
        />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
          {total} word{total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mr-1">
          status
        </span>
        {ALL_STATES.map((s) => (
          <Chip
            key={s}
            active={activeStates.has(s)}
            onClick={() => onToggleState(s)}
            label={SRS_LABEL[s]}
            badge={String(counts[s] ?? 0)}
            colorClass={SRS_DOT[s]}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mr-1">
          jlpt
        </span>
        {ALL_LEVELS.map((l) => (
          <Chip
            key={l}
            active={activeLevels.has(l)}
            onClick={() => onToggleLevel(l)}
            label={`N${l}`}
          />
        ))}
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            className="
              ml-auto text-[10px] uppercase tracking-widest
              text-muted-foreground hover:text-foreground
              transition-colors duration-150
            "
          >
            clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  badge,
  colorClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
  colorClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-2.5 py-1 rounded-full',
        'text-xs tracking-wide',
        'border transition-[background-color,color,border-color] duration-150',
        active
          ? 'border-foreground/60 bg-foreground/[0.08] text-foreground'
          : 'border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/30',
      )}
    >
      {colorClass ? (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', colorClass)}
          aria-hidden
        />
      ) : null}
      <span className="capitalize">{label}</span>
      {badge != null ? (
        <span className="text-muted-foreground/60 tabular-nums">{badge}</span>
      ) : null}
    </button>
  );
}

function HeaderRow({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="grid grid-cols-[2.25rem_1fr_5rem_4rem_4rem_5rem] items-center gap-x-4 px-4 py-2.5 bg-surface/40 border-b border-border/50">
      <input
        type="checkbox"
        checked={allSelected}
        onChange={onToggleAll}
        className="h-3.5 w-3.5 accent-accent cursor-pointer"
        aria-label="Toggle select all"
      />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        word
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        status
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
        seen
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
        reviews
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
        due
      </div>
    </div>
  );
}

function Row({
  word,
  selected,
  onToggle,
}: {
  word: WordListItem;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        'grid grid-cols-[2.25rem_1fr_5rem_4rem_4rem_5rem] items-center gap-x-4 px-4 py-3',
        'transition-colors duration-100',
        selected ? 'bg-accent/[0.07]' : 'hover:bg-muted/20',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-3.5 w-3.5 accent-accent cursor-pointer"
        aria-label={`Select ${word.surface}`}
      />
      <div className="min-w-0">
        <div className="font-display text-lg text-foreground leading-tight truncate">
          {word.surface}
          {word.jlptLevel ? (
            <span className="ml-2 text-[10px] tracking-widest text-accent">
              N{word.jlptLevel}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {word.reading}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', SRS_DOT[word.state])}
          aria-hidden
        />
        <span className="text-foreground/80 capitalize">
          {SRS_LABEL[word.state]}
        </span>
      </div>
      <div
        className="text-xs text-muted-foreground tabular-nums"
        title={`Seen ${word.seenCount} time${word.seenCount === 1 ? '' : 's'} across all sessions`}
      >
        {word.seenCount}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {word.reviewCount}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatDue(word.dueDate, word.state)}
      </div>
    </li>
  );
}

function formatDue(iso: string | null, state: SrsState): string {
  if (state === 'known') return '—';
  if (!iso) return '—';
  if (iso.startsWith('9999')) return '—';
  const today = new Date().toISOString().slice(0, 10);
  const dueDay = iso.slice(0, 10);
  if (dueDay <= today) return 'today';
  const d = new Date(dueDay + 'T00:00:00');
  const diff = Math.round(
    (d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000,
  );
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return `${diff}d`;
  if (diff < 60) return `${Math.round(diff / 7)}w`;
  return `${Math.round(diff / 30)}mo`;
}

function BulkBar({
  count,
  onMarkKnown,
  onDelete,
  onClear,
}: {
  count: number;
  onMarkKnown: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="fade-rise flex items-center justify-between gap-4 rounded-md border border-foreground/30 bg-surface/60 px-4 py-2.5">
      <div className="text-sm text-foreground/90 tabular-nums">
        {count} selected
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMarkKnown}
          className="
            text-xs tracking-wide px-3 py-1.5 rounded-md
            border border-border/70 text-foreground/80
            hover:bg-muted/40 hover:text-foreground
            transition-[background-color,color,transform] duration-150 ease-out-strong
            active:scale-[0.97]
          "
        >
          Mark as known
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="
            text-xs tracking-wide px-3 py-1.5 rounded-md
            border border-[hsl(var(--srs-lapsed))]/40 text-[hsl(var(--srs-lapsed))]
            hover:bg-[hsl(var(--srs-lapsed))]/10
            transition-[background-color,transform] duration-150 ease-out-strong
            active:scale-[0.97]
          "
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onClear}
          className="
            text-xs tracking-widest uppercase
            text-muted-foreground hover:text-foreground
            transition-colors duration-150 px-2
          "
        >
          clear
        </button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-10 rounded bg-muted/30" />
      <div className="h-10 rounded bg-muted/30" />
      <div className="h-10 rounded bg-muted/30" />
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-surface/30 px-6 py-10 text-center text-sm text-muted-foreground">
      {filtered
        ? 'No words match the current filters.'
        : 'No words yet. Open the Read tab and add some from a session.'}
    </div>
  );
}
