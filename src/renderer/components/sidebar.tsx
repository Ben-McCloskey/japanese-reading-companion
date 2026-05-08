import { cn } from '@renderer/lib/cn';
import { useUpdateStatus } from '@renderer/lib/update-status';
import { api } from '@platform';
import type { Route } from '@renderer/types/route';

const NAV: ReadonlyArray<{ route: Route; label: string; jp: string }> = [
  { route: 'read', label: 'read', jp: '読' },
  { route: 'review', label: 'review', jp: '復' },
  { route: 'sessions', label: 'sessions', jp: '記' },
  { route: 'words', label: 'words', jp: '語' },
  { route: 'settings', label: 'settings', jp: '設' },
];

interface SidebarProps {
  current: Route;
  onSelect: (route: Route) => void;
}

export function Sidebar({ current, onSelect }: SidebarProps) {
  const updateStatus = useUpdateStatus();

  return (
    <aside className="hidden md:flex w-56 shrink-0 border-r border-border/70 bg-surface/40 flex-col">
      {/* Empty drag region — leaves the macOS traffic lights an unobstructed
          row to live in. Wordmark sits below, out of their way. */}
      <div className="title-spacer" />

      <div className="px-6 pt-1 pb-3">
        <span className="font-display text-[13px] tracking-widest text-muted-foreground/70 select-none">
          読 · companion
        </span>
      </div>

      <nav className="flex-1 px-3 pt-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = item.route === current;
            return (
              <li key={item.route}>
                <button
                  type="button"
                  onClick={() => onSelect(item.route)}
                  className={cn(
                    'group titlebar-no-drag w-full flex items-center gap-3 px-3 py-2 rounded-md',
                    'text-left text-sm tracking-wide',
                    'transition-colors duration-150 ease-out-strong',
                    'active:scale-[0.98] transition-transform',
                    active
                      ? 'text-foreground bg-muted/60'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
                  )}
                >
                  <span
                    className={cn(
                      'font-display text-base w-5 text-center transition-colors',
                      active ? 'text-accent' : 'text-muted-foreground/60',
                    )}
                    aria-hidden
                  >
                    {item.jp}
                  </span>
                  <span className="lowercase">{item.label}</span>
                  {active ? (
                    <span
                      className="ml-auto h-1 w-1 rounded-full bg-accent"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-3 pb-4 pt-2">
        <UpdateFooter status={updateStatus} />
      </div>
    </aside>
  );
}

function UpdateFooter({ status }: { status: ReturnType<typeof useUpdateStatus> }) {
  if (status.kind === 'ready') {
    return (
      <button
        type="button"
        onClick={() => void api.installUpdate()}
        className="
          fade-rise w-full text-left
          rounded-md border border-accent/40 bg-accent/[0.08]
          px-3 py-2.5
          transition-[background-color,transform] duration-150 ease-out-strong
          hover:bg-accent/15 active:scale-[0.98]
          focus-visible:outline-none focus-visible:bg-accent/15
        "
      >
        <div className="text-[10px] uppercase tracking-widest text-accent">
          update ready
        </div>
        <div className="mt-0.5 text-xs text-foreground/85">
          v{status.version} · click to restart
        </div>
      </button>
    );
  }

  if (status.kind === 'downloading') {
    return (
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
        downloading update… {status.percent}%
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div
        className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground/60"
        title={status.error}
      >
        update check failed
      </div>
    );
  }

  return (
    <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground/60">
      v{__APP_VERSION__}
    </div>
  );
}
