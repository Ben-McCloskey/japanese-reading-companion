import type { Token } from '@shared/types/tokenizer';
import type { DeckEntry } from '@shared/types/deck';
import { hasKanji, katakanaToHiragana } from '@renderer/lib/kana';
import { isLookupSkippable } from '@renderer/lib/grammar';
import { SRS_UNDERLINE } from '@renderer/lib/srs-style';
import { cn } from '@renderer/lib/cn';

interface ReadingTextProps {
  tokens: Token[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Map of `${basicForm}|${reading_hiragana}` → SRS deck entry. */
  deckStates: Record<string, DeckEntry>;
}

export function ReadingText({
  tokens,
  selectedIndex,
  onSelect,
  deckStates,
}: ReadingTextProps) {
  return (
    <div className="ruby-base font-sans text-[26px] leading-[2.1] tracking-[0.01em] text-foreground">
      {tokens.map((t, i) => {
        if (t.surface === '\n' || t.surface === '\r\n') {
          return <br key={i} />;
        }

        const reading = t.reading ? katakanaToHiragana(t.reading) : '';
        const showRuby =
          hasKanji(t.surface) && reading && reading !== t.surface;
        const skippable = isLookupSkippable(t);
        const isSelected = selectedIndex === i;

        const inner = showRuby ? (
          <ruby>
            {t.surface}
            <rt>{reading}</rt>
          </ruby>
        ) : (
          t.surface
        );

        if (skippable) {
          return (
            <span key={i} className="text-foreground/80">
              {inner}
            </span>
          );
        }

        const deckKey = `${t.basicForm}|${reading || t.basicForm}`;
        const deckEntry = deckStates[deckKey];

        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(i);
              }
            }}
            className={cn(
              'cursor-pointer rounded-[3px] -mx-px px-px',
              'transition-[background-color] duration-100',
              'focus-visible:outline-none',
              deckEntry ? SRS_UNDERLINE[deckEntry.state] : null,
              isSelected
                ? 'bg-accent/25 dark:bg-accent/40'
                : 'hover:bg-accent/15 dark:hover:bg-accent/25 focus-visible:bg-accent/15 dark:focus-visible:bg-accent/25',
            )}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
