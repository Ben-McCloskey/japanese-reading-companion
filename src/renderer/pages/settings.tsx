import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { Toggle } from '@renderer/components/ui/toggle';
import { applyTheme, persistTheme, type Theme } from '@renderer/lib/theme';
import { setPreferredVoiceUri, useTts } from '@renderer/lib/tts';
import { api } from '@platform';
import type { SyncInfo, SyncStatus } from '@shared/ipc';

const REVIEW_CAP_KEY = 'dailyReviewCap';
const DEFAULT_REVIEW_CAP = 20;

export function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const [reviewCap, setReviewCap] = useState<string>(String(DEFAULT_REVIEW_CAP));
  const [reviewCapDirty, setReviewCapDirty] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tts = useTts();

  useEffect(() => {
    void api.getSetting(REVIEW_CAP_KEY).then((res) => {
      if (res.ok && res.data != null) setReviewCap(res.data);
    });
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  async function onToggleTheme(nextDark: boolean) {
    const next: Theme = nextDark ? 'dark' : 'light';
    setTheme(next);
    setError(null);
    try {
      await persistTheme(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save theme.');
    }
  }

  async function commitReviewCap(raw: string) {
    const cleaned = raw.trim();
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      setReviewCap(String(DEFAULT_REVIEW_CAP));
      setReviewCapDirty(false);
      return;
    }
    const value = String(Math.floor(n));
    setReviewCap(value);
    setReviewCapDirty(false);
    try {
      await api.setSetting(REVIEW_CAP_KEY, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save setting.');
    }
  }

  async function onReimport() {
    if (reimporting) return;
    const ok = window.confirm(
      'Re-download and re-parse JMdict?\n\nYour deck and review history are kept; only the dictionary cache is rebuilt. This takes about a minute.',
    );
    if (!ok) return;
    setReimporting(true);
    setError(null);
    try {
      // Triggers the SetupPage flow via the dictionary status broadcast.
      void api.importDict();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start re-import.');
      setReimporting(false);
    }
  }

  const ttsVoices = tts.kind === 'ready' ? tts.voices : [];
  const currentVoiceUri = tts.kind === 'ready' ? tts.voice.voiceURI : '';
  const ttsErrorLabel =
    tts.kind === 'no-japanese-voice'
      ? 'No Japanese voice installed'
      : tts.kind === 'unsupported'
        ? 'Unavailable in this runtime'
        : tts.kind === 'loading'
          ? 'Loading…'
          : null;

  return (
    <PageShell
      eyebrow="設 · settings"
      title="Settings"
      subtitle="Preferences are stored locally in your SQLite database. Nothing leaves the device."
    >
      <Section title="Display">
        <Row
          label="Dark mode"
          hint="Sumi-ink palette for late-night reading."
          control={
            <Toggle
              checked={theme === 'dark'}
              onCheckedChange={onToggleTheme}
              label="Toggle dark mode"
            />
          }
        />
      </Section>

      <Section title="Review">
        <Row
          label="Daily cap"
          hint="Maximum cards shown in a review session. Use 0 for no limit."
          control={
            <input
              type="number"
              min={0}
              step={1}
              value={reviewCap}
              onChange={(e) => {
                setReviewCap(e.target.value);
                setReviewCapDirty(true);
              }}
              onBlur={() => {
                if (reviewCapDirty) void commitReviewCap(reviewCap);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              className="
                w-20 text-right tabular-nums
                bg-surface/40 border border-border/70 rounded-md
                px-3 py-1.5 text-sm text-foreground
                focus:outline-none focus:border-foreground/40
                transition-colors duration-150
              "
            />
          }
        />
      </Section>

      <Section title="Pronunciation">
        <Row
          label="Japanese voice"
          hint={
            ttsErrorLabel == null
              ? 'Premium and Enhanced voices sound noticeably better than the defaults — download them in macOS System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.'
              : 'Web Speech API · uses the OS-installed Japanese voice.'
          }
          control={
            ttsErrorLabel ? (
              <span className="text-sm text-muted-foreground">
                {ttsErrorLabel}
              </span>
            ) : (
              <select
                value={currentVoiceUri}
                onChange={(e) => setPreferredVoiceUri(e.target.value)}
                className="
                  max-w-[14rem] truncate
                  bg-surface/40 border border-border/70 rounded-md
                  px-3 py-1.5 text-sm text-foreground
                  focus:outline-none focus:border-foreground/40
                  transition-colors duration-150
                "
              >
                {ttsVoices.map((v) => (
                  <option key={v.uri} value={v.uri}>
                    {v.name}
                    {v.quality !== 'standard' ? ` · ${v.quality}` : ''}
                  </option>
                ))}
              </select>
            )
          }
        />
      </Section>

      <Section title="Dictionary">
        <Row
          label="JMdict cache"
          hint="Re-download and re-parse the dictionary. Your deck stays."
          control={
            <button
              type="button"
              disabled={reimporting}
              onClick={onReimport}
              className="
                text-xs tracking-wide
                px-3 py-1.5 rounded-md
                border border-border/70 text-foreground/80
                hover:bg-muted/40 hover:text-foreground
                transition-[background-color,color,transform] duration-150 ease-out-strong
                active:scale-[0.97]
                disabled:opacity-60
              "
            >
              {reimporting ? 'Starting…' : 'Re-import'}
            </button>
          }
        />
      </Section>

      <Section title="Sync">
        <SyncPanel onError={setError} />
      </Section>

      <Section title="Shortcuts">
        <ShortcutsList />
      </Section>

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
        >
          {error}
        </div>
      ) : null}
    </PageShell>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="mb-10">
      <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
        {title}
      </h2>
      <div className="divide-y divide-border/60 rounded-md border border-border/60 bg-surface/30">
        {children}
      </div>
    </section>
  );
}

interface RowProps {
  label: string;
  hint?: string;
  control: React.ReactNode;
}

function Row({ label, hint, control }: RowProps) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-4">
      <div className="space-y-1 min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

// ---- Sync panel -------------------------------------------------------

function statusLabel(s: SyncStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Idle';
    case 'pushing':
      return 'Pushing…';
    case 'pulling':
      return 'Pulling…';
    case 'error':
      return `Error: ${s.error}`;
  }
}

function statusDot(s: SyncStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'bg-foreground/40';
    case 'pushing':
    case 'pulling':
      return 'bg-emerald-500';
    case 'error':
      return 'bg-accent';
  }
}

function shortDeviceId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86_400)}d ago`;
}

function SyncPanel({ onError }: { onError: (msg: string | null) => void }) {
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  const [folderInput, setFolderInput] = useState('');
  const [folderDirty, setFolderDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.getSyncInfo();
    if (res.ok) {
      setInfo(res.data);
      setStatus(res.data.status);
      if (!folderDirty) setFolderInput(res.data.folder);
    } else {
      onError(res.error);
    }
  }, [folderDirty, onError]);

  useEffect(() => {
    void refresh();
    const off = api.onSyncStatus((s) => {
      setStatus(s);
      // Status transitions usually mean peers / pending count changed.
      void refresh();
    });
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      off();
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function onRun() {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const res = await api.runSync();
      if (!res.ok) onError(res.error);
      else void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function commitFolder() {
    const next = folderInput.trim();
    setFolderDirty(false);
    onError(null);
    const res = await api.setSyncFolder({
      folder: next.length > 0 ? next : null,
    });
    if (!res.ok) onError(res.error);
    else void refresh();
  }

  async function onResetFolder() {
    setFolderDirty(false);
    onError(null);
    const res = await api.setSyncFolder({ folder: null });
    if (!res.ok) onError(res.error);
    else void refresh();
  }

  async function onReset() {
    if (busy) return;
    const ok = window.confirm(
      'Re-pull every sync event from peers? This is safe — duplicate events are deduped — but the next sync may be slower.',
    );
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      const res = await api.resetSync();
      if (!res.ok) onError(res.error);
      else void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onBackfill() {
    if (busy) return;
    const ok = window.confirm(
      'Push every existing word and session to your iPhone? Sync only carries forward new changes, so a one-time backfill is needed for data you already had before sync was set up. Safe to run multiple times.',
    );
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      const res = await api.backfillSync();
      if (!res.ok) {
        onError(res.error);
        return;
      }
      window.alert(
        `Queued ${res.data.words} word${res.data.words === 1 ? '' : 's'} and ${res.data.sessions} session${res.data.sessions === 1 ? '' : 's'} to sync. iCloud should propagate them within a few minutes.`,
      );
      void refresh();
    } catch (e) {
      // Catch unregistered-IPC-handler rejections (most likely after a code
      // update without a dev-server restart) so the user sees a clear
      // message instead of a silent no-op.
      const msg = e instanceof Error ? e.message : String(e);
      onError(
        msg.includes('No handler registered')
          ? 'Backfill is not available — restart the app (the dev server picks up new code on relaunch only).'
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  const peers = info?.peers ?? [];
  const pending = info?.pendingPushCount ?? 0;

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusDot(status)}`}
            aria-hidden
          />
          <span className="text-foreground/90">{statusLabel(status)}</span>
          {pending > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              · {pending} pending
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className="
            text-xs tracking-wide px-3 py-1.5 rounded-md
            border border-border/70 text-foreground/80
            hover:bg-muted/40 hover:text-foreground
            transition-[background-color,color,transform] duration-150 ease-out-strong
            active:scale-[0.97]
            disabled:opacity-60
          "
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          sync folder
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={folderInput}
            onChange={(e) => {
              setFolderInput(e.target.value);
              setFolderDirty(true);
            }}
            onBlur={() => {
              if (folderDirty) void commitFolder();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            spellCheck={false}
            className="
              flex-1 min-w-0
              bg-surface/40 border border-border/70 rounded-md
              px-3 py-1.5 text-xs text-foreground font-mono
              focus:outline-none focus:border-foreground/40
              transition-colors duration-150
            "
          />
          <button
            type="button"
            onClick={onResetFolder}
            className="
              text-[11px] tracking-wide text-muted-foreground
              hover:text-foreground transition-colors duration-150
            "
            title="Reset to default iCloud Drive folder"
          >
            default
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          The folder both Mac and iPhone read/write events to. Default is
          iCloud Drive → JapaneseReadingCompanion → sync.
        </div>
      </div>

      {info ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            this device
          </div>
          <div className="text-xs text-foreground/85 font-mono">
            {shortDeviceId(info.deviceId)}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          peers
        </div>
        {peers.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No other devices have synced yet.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {peers.map((p) => (
              <li
                key={p.deviceId}
                className="flex items-center justify-between text-xs gap-4"
              >
                <span className="font-mono text-foreground/80">
                  {shortDeviceId(p.deviceId)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  last seen {timeAgo(p.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-2 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackfill}
          disabled={busy}
          className="
            text-[11px] tracking-wide text-muted-foreground
            hover:text-foreground transition-colors duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          title="Push every existing word and session to peers (one-time)"
        >
          Backfill from existing data
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={busy || peers.length === 0}
          className="
            text-[11px] tracking-wide text-muted-foreground
            hover:text-accent transition-colors duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          Re-pull peer events
        </button>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘ ↵', label: 'Tokenize the pasted text' },
  { keys: 'Esc', label: 'Close the lookup panel' },
  { keys: 'Space', label: 'Flip the flashcard' },
  { keys: '1 / 2 / 3 / 4', label: 'Rate Again / Hard / Good / Easy' },
  { keys: '⌘ 1…5', label: 'Switch sections (Read · Review · …)' },
];

function ShortcutsList() {
  return (
    <div className="px-4 py-4">
      <ul className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <li
            key={s.keys}
            className="flex items-center justify-between text-sm gap-6"
          >
            <span className="text-foreground/85">{s.label}</span>
            <kbd className="text-[11px] tracking-widest text-muted-foreground bg-muted/40 rounded px-2 py-0.5 tabular-nums">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}
