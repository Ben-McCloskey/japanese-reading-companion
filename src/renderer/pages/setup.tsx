import { useState } from 'react';
import type { DictStatus, DictImportPhase } from '@shared/ipc';

interface SetupPageProps {
  status: DictStatus;
  onImport: () => void;
}

const PHASE_LABEL: Record<DictImportPhase, string> = {
  downloading: 'Downloading JMdict from edrdg.org',
  decompressing: 'Decompressing',
  parsing: 'Parsing entries',
  finalizing: 'Finalizing',
  jlpt: 'Loading JLPT levels',
};

function formatBytes(n: number | undefined): string {
  if (n == null) return '—';
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = n / 1024;
  return `${kb.toFixed(0)} KB`;
}

export function SetupPage({ status, onImport }: SetupPageProps) {
  const [clicked, setClicked] = useState(false);

  const isImporting = status.kind === 'importing';
  const isFailed = status.kind === 'failed';

  return (
    <div className="h-full flex flex-col">
      <div className="titlebar-drag h-11" />
      <div className="flex-1 flex items-center justify-center px-12 pb-16">
        <div className="max-w-md w-full">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
            一 · first run
          </div>
          <h1 className="font-display text-4xl tracking-tighter text-foreground">
            Set up the dictionary
          </h1>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            We need to download JMdict — the standard Japanese-English
            dictionary — and parse it into a local SQLite database. This
            happens once. About 13&nbsp;MB over the wire and a minute of
            parsing.
          </p>

          <div className="mt-10">
            {!isImporting && !isFailed ? (
              <button
                type="button"
                disabled={clicked}
                onClick={() => {
                  setClicked(true);
                  onImport();
                }}
                className="
                  group inline-flex items-center gap-2
                  bg-foreground text-background
                  text-sm tracking-wide
                  px-5 py-2.5 rounded-md
                  transition-transform duration-150 ease-out-strong
                  active:scale-[0.97]
                  disabled:opacity-60 disabled:cursor-not-allowed
                "
              >
                {clicked ? 'Starting…' : 'Download dictionary'}
                <span aria-hidden className="opacity-70">→</span>
              </button>
            ) : null}

            {isImporting ? <ImportingIndicator status={status} /> : null}

            {isFailed ? (
              <div className="space-y-4">
                <div
                  role="alert"
                  className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
                >
                  {status.error}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClicked(true);
                    onImport();
                  }}
                  className="
                    inline-flex items-center gap-2
                    border border-border
                    text-sm tracking-wide
                    px-4 py-2 rounded-md
                    hover:bg-muted/40
                    transition-colors duration-150
                    active:scale-[0.97] [transition-property:transform,background-color]
                  "
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportingIndicator({
  status,
}: {
  status: Extract<DictStatus, { kind: 'importing' }>;
}) {
  const pct =
    status.phase === 'downloading' && status.received != null && status.total
      ? (status.received / status.total) * 100
      : null;

  return (
    <div className="space-y-5">
      <div className="text-sm text-foreground">{PHASE_LABEL[status.phase]}…</div>

      <div
        className="h-[2px] w-full bg-muted/40 rounded-full overflow-hidden"
        aria-label="progress"
      >
        {pct != null ? (
          <div
            className="h-full bg-accent transition-[width] duration-200 ease-out-strong"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-accent/70 animate-[indeterminate_1.6s_ease-in-out_infinite]" />
        )}
      </div>

      <div className="text-xs text-muted-foreground tabular-nums">
        {status.phase === 'downloading'
          ? `${formatBytes(status.received)} / ${formatBytes(status.total ?? undefined)}`
          : status.phase === 'parsing'
            ? `${(status.entries ?? 0).toLocaleString()} entries parsed`
            : ''}
      </div>

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(120%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
