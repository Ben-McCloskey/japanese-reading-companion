import { cn } from '@renderer/lib/cn';

export type Rating = 1 | 2 | 3 | 4;

interface RatingDef {
  label: string;
  hint: string;
  key: '1' | '2' | '3' | '4';
  className: string;
}

export const RATINGS: Record<Rating, RatingDef> = {
  1: {
    label: 'Again',
    hint: 'forgot',
    key: '1',
    className:
      'border-[hsl(var(--srs-lapsed))]/40 text-[hsl(var(--srs-lapsed))] hover:bg-[hsl(var(--srs-lapsed))]/10',
  },
  2: {
    label: 'Hard',
    hint: 'struggled',
    key: '2',
    className:
      'border-border/60 text-muted-foreground hover:bg-muted/30 hover:text-foreground',
  },
  3: {
    label: 'Good',
    hint: 'recalled',
    key: '3',
    className:
      'border-foreground/40 text-foreground hover:bg-foreground hover:text-background',
  },
  4: {
    label: 'Easy',
    hint: 'instant',
    key: '4',
    className:
      'border-[hsl(var(--srs-known))]/40 text-[hsl(var(--srs-known))] hover:bg-[hsl(var(--srs-known))]/10',
  },
};

interface RateBarProps {
  onRate: (r: Rating) => void;
  busy: boolean;
  /** Compact mode shrinks padding and hides the keyboard hint. */
  size?: 'default' | 'compact';
}

export function RateBar({ onRate, busy, size = 'default' }: RateBarProps) {
  const compact = size === 'compact';
  return (
    <div className={cn('grid grid-cols-4', compact ? 'gap-1.5' : 'gap-2')}>
      {([1, 2, 3, 4] as const).map((r) => {
        const def = RATINGS[r];
        return (
          <button
            key={r}
            type="button"
            disabled={busy}
            onClick={() => onRate(r)}
            className={cn(
              'flex flex-col items-center',
              compact ? 'gap-0.5 px-2 py-2 rounded-md' : 'gap-1 px-3 py-3 rounded-lg',
              'border',
              'transition-[background-color,color,transform] duration-150 ease-out-strong',
              'active:scale-[0.97]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              def.className,
            )}
          >
            <span
              className={cn(
                'tracking-wide font-medium',
                compact ? 'text-xs' : 'text-sm',
              )}
            >
              {def.label}
            </span>
            {compact ? (
              <span className="text-[9px] tracking-widest opacity-60">
                {def.hint}
              </span>
            ) : (
              <span className="text-[10px] tracking-widest opacity-70">
                {def.key} · {def.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
