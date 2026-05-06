import { useEffect, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { Toggle } from '@renderer/components/ui/toggle';
import { applyTheme, persistTheme, type Theme } from '@renderer/lib/theme';
import { setPreferredVoiceUri, useTts } from '@renderer/lib/tts';

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
    void window.api.getSetting(REVIEW_CAP_KEY).then((res) => {
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
      await window.api.setSetting(REVIEW_CAP_KEY, value);
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
      void window.api.importDict();
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
