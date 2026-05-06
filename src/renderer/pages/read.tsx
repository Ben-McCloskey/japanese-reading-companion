import { useEffect, useState } from 'react';
import { PageShell } from '@renderer/components/page-shell';
import { ReadingText } from '@renderer/components/reading-text';
import { WordPanel } from '@renderer/components/word-panel';
import { useTokenizerStatus } from '@renderer/lib/tokenizer-status';
import { sentenceAt } from '@renderer/lib/sentence';
import { katakanaToHiragana } from '@renderer/lib/kana';
import { isLookupSkippable } from '@renderer/lib/grammar';
import type { Token } from '@shared/types/tokenizer';
import type { DeckEntry } from '@shared/types/deck';

function deckKeyForToken(t: Token): string {
  const reading = t.reading ? katakanaToHiragana(t.reading) : t.basicForm;
  return `${t.basicForm}|${reading}`;
}

interface ReadPageProps {
  /** When set, the page loads that session's text + tokens on mount. */
  pendingSessionId?: number | null;
  onConsumePendingSession?: () => void;
}

export function ReadPage({
  pendingSessionId,
  onConsumePendingSession,
}: ReadPageProps = {}) {
  const tokStatus = useTokenizerStatus();
  const [text, setText] = useState('');
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [deckStates, setDeckStates] = useState<Record<string, DeckEntry>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load a session when the user navigates here from the Sessions list.
  useEffect(() => {
    if (pendingSessionId == null) return;
    let cancelled = false;
    void (async () => {
      const res = await window.api.getSession({ id: pendingSessionId });
      if (cancelled) return;
      if (res.ok && res.data) {
        setText(res.data.rawText);
        setTokens(res.data.tokens);
        setSessionId(res.data.id);
        setSelectedIndex(null);
        const deckRes = await window.api.getDeckStatesBatch({
          keys: uniqueDeckKeys(res.data.tokens),
        });
        if (!cancelled && deckRes.ok) setDeckStates(deckRes.data);
      } else if (res.ok === false) {
        setError(res.error);
      }
      onConsumePendingSession?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingSessionId, onConsumePendingSession]);

  async function tokenizeText(input: string) {
    setBusy(true);
    setError(null);
    setSelectedIndex(null);
    try {
      const tokRes = await window.api.tokenize(input);
      if (!tokRes.ok) {
        setError(tokRes.error);
        return;
      }
      const newTokens = tokRes.data;
      setTokens(newTokens);

      // Persist session and refresh deck states for the new token list. Both
      // run in parallel — they don't depend on each other.
      const [sessionRes, deckRes] = await Promise.all([
        window.api.saveSession({ rawText: input, tokens: newTokens }),
        window.api.getDeckStatesBatch({
          keys: uniqueDeckKeys(newTokens),
        }),
      ]);

      if (sessionRes.ok) setSessionId(sessionRes.data.id);
      if (deckRes.ok) setDeckStates(deckRes.data);
    } finally {
      setBusy(false);
    }
  }

  async function onTokenize() {
    await tokenizeText(text);
  }

  async function onPaste() {
    setError(null);
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) return;
      setText(clip);
      if (tokStatus.kind === 'ready' && !busy) {
        await tokenizeText(clip);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not read clipboard: ${e.message}`
          : 'Could not read clipboard.',
      );
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onTokenize();
    }
  }

  const tokenizerReady = tokStatus.kind === 'ready';
  const selectedToken =
    tokens && selectedIndex != null ? (tokens[selectedIndex] ?? null) : null;
  const selectedKey = selectedToken ? deckKeyForToken(selectedToken) : null;
  const selectedDeckEntry = selectedKey ? (deckStates[selectedKey] ?? null) : null;
  const firstSentence =
    tokens && selectedIndex != null ? sentenceAt(tokens, selectedIndex) : null;

  function onDeckChange(key: string, entry: DeckEntry | null) {
    setDeckStates((prev) => {
      const next = { ...prev };
      if (entry) next[key] = entry;
      else delete next[key];
      return next;
    });
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0">
        <PageShell
          eyebrow="読 · read"
          title="Reading"
          subtitle="Paste Japanese text. Click any word for its meaning, reading, and grammar — and add the ones you want to study to your deck."
        >
          <div className="space-y-3">
            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                rows={4}
                spellCheck={false}
                className="
                  w-full font-sans text-lg leading-relaxed
                  bg-surface/40 border border-border/70 rounded-md
                  pl-4 pr-10 py-3 text-foreground placeholder:text-muted-foreground
                  focus:outline-none focus:border-foreground/40
                  transition-colors duration-150
                "
                placeholder="今日は会議が三時からあります…"
              />
              {text ? (
                <button
                  type="button"
                  onClick={() => {
                    setText('');
                    setTokens(null);
                    setSelectedIndex(null);
                  }}
                  aria-label="Clear text"
                  title="Clear text"
                  className="
                    absolute top-2.5 right-2.5
                    inline-flex items-center justify-center
                    h-6 w-6 rounded-md
                    text-muted-foreground hover:text-foreground hover:bg-muted/50
                    transition-[background-color,color,transform] duration-150 ease-out-strong
                    active:scale-[0.92]
                    focus-visible:outline-none focus-visible:bg-muted/50
                  "
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onPaste()}
                  aria-label="Paste from clipboard"
                  title="Paste from clipboard"
                  className="
                    absolute top-2.5 right-2.5
                    inline-flex items-center justify-center
                    h-6 w-6 rounded-md
                    text-muted-foreground hover:text-foreground hover:bg-muted/50
                    transition-[background-color,color,transform] duration-150 ease-out-strong
                    active:scale-[0.92]
                    focus-visible:outline-none focus-visible:bg-muted/50
                  "
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {/* Clipboard with a subtle clip on top */}
                    <rect x="3" y="3.5" width="8" height="9" rx="1" />
                    <path d="M5.5 3.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1" />
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {tokenizerReady ? (
                  <>Tokenizer ready</>
                ) : tokStatus.kind === 'failed' ? (
                  <span className="text-accent">
                    Tokenizer failed: {tokStatus.error}
                  </span>
                ) : (
                  <>Warming kuromoji…</>
                )}
              </div>
              <button
                type="button"
                disabled={!tokenizerReady || busy}
                onClick={() => void onTokenize()}
                className="
                  inline-flex items-center gap-2
                  bg-foreground text-background text-sm tracking-wide
                  px-4 py-2 rounded-md
                  transition-transform duration-150 ease-out-strong
                  active:scale-[0.97]
                  disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                {busy ? 'Tokenizing…' : 'Tokenize'}
                <kbd className="text-[10px] tracking-widest opacity-70">⌘↵</kbd>
              </button>
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
              >
                {error}
              </div>
            ) : null}
          </div>

          {tokens ? (
            <article
              key={tokens.length}
              className="fade-rise mt-12 rounded-lg border border-border/60 bg-surface/30 px-8 py-10"
            >
              <ReadingText
                tokens={tokens}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                deckStates={deckStates}
              />
            </article>
          ) : null}
        </PageShell>
      </div>

      <WordPanel
        token={selectedToken}
        sessionId={sessionId}
        firstSentence={firstSentence}
        deckEntry={selectedDeckEntry}
        onClose={() => setSelectedIndex(null)}
        onDeckChange={onDeckChange}
      />
    </div>
  );
}

function uniqueDeckKeys(tokens: Token[]): Array<{ surface: string; reading: string }> {
  const seen = new Set<string>();
  const out: Array<{ surface: string; reading: string }> = [];
  for (const t of tokens) {
    if (isLookupSkippable(t)) continue;
    const reading = t.reading ? katakanaToHiragana(t.reading) : t.basicForm;
    const key = `${t.basicForm}|${reading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ surface: t.basicForm, reading });
  }
  return out;
}
