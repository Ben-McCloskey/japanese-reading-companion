import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { cn } from '@renderer/lib/cn';
import type { SessionListItem } from '@shared/types/sessions';

interface SessionsPageProps {
  onOpenSession: (id: number) => void;
}

export function SessionsPage({ onOpenSession }: SessionsPageProps) {
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await window.api.listSessions();
    if (res.ok) setItems(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: number) {
    if (pendingDelete === id) {
      const res = await window.api.deleteSession({ id });
      if (res.ok) void load();
      else setError(res.error);
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
      // auto-cancel after a beat so the row doesn't sit in a "confirm" state forever
      setTimeout(() => setPendingDelete((p) => (p === id ? null : p)), 4000);
    }
  }

  return (
    <PageShell
      eyebrow="記 · sessions"
      title="Sessions"
      subtitle="Every text you've processed is saved here. Reopen any session to revisit it with current word states."
    >
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
        >
          {error}
        </div>
      ) : null}

      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="rounded-md border border-border/60 divide-y divide-border/50 overflow-hidden">
          {items.map((s) => (
            <Row
              key={s.id}
              session={s}
              pendingDelete={pendingDelete === s.id}
              onOpen={() => onOpenSession(s.id)}
              onDelete={() => void onDelete(s.id)}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function Row({
  session,
  pendingDelete,
  onOpen,
  onDelete,
}: {
  session: SessionListItem;
  pendingDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex items-stretch gap-4 px-5 py-4 transition-colors duration-100 hover:bg-muted/20">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums w-28 shrink-0">
            {formatDate(session.createdAt)}
          </span>
          <div className="font-display text-base text-foreground truncate">
            {session.title}
          </div>
        </div>
        <div className="mt-1 ml-[7.5rem] text-xs text-muted-foreground">
          {session.newWordsCount} new word{session.newWordsCount === 1 ? '' : 's'} added
        </div>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpen}
          className="
            text-[10px] uppercase tracking-widest
            px-2 py-1 rounded-md
            text-muted-foreground hover:text-foreground hover:bg-muted/40
            transition-[background-color,color,transform] duration-150 ease-out-strong
            active:scale-[0.97]
          "
        >
          open
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={cn(
            'text-[10px] uppercase tracking-widest',
            'px-2 py-1 rounded-md',
            'transition-[background-color,color,transform] duration-150 ease-out-strong',
            'active:scale-[0.97]',
            pendingDelete
              ? 'bg-[hsl(var(--srs-lapsed))]/15 text-[hsl(var(--srs-lapsed))]'
              : 'text-muted-foreground/70 hover:text-[hsl(var(--srs-lapsed))]',
          )}
        >
          {pendingDelete ? 'confirm?' : 'delete'}
        </button>
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  // ISO format from SQLite: "YYYY-MM-DD HH:MM:SS"
  const norm = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (isToday) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function ListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-14 rounded bg-muted/30" />
      <div className="h-14 rounded bg-muted/30" />
      <div className="h-14 rounded bg-muted/30" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-surface/30 px-6 py-10 text-center text-sm text-muted-foreground">
      No sessions yet. Open the Read tab and tokenize some Japanese.
    </div>
  );
}
