import { cn } from '@renderer/lib/cn';
import type { Route } from '@renderer/types/route';

/**
 * Mobile navigation. Five tabs anchored to the bottom of the viewport,
 * thumb-reachable, with the home-indicator safe-area baked into the bg so
 * the strip extends to the device edge.
 *
 * Visual choice: the kanji glyph (読 復 記 etc.) IS the icon. We already use
 * these in the sidebar as accent characters, and they carry the brand
 * better than yet-another-set-of-Lucide-glyphs. The English label sits
 * below, set in tracking-widest small-caps so it reads as a typographic
 * caption rather than competing with the kanji.
 */

const NAV: ReadonlyArray<{ route: Route; label: string; jp: string }> = [
  { route: 'read', label: 'read', jp: '読' },
  { route: 'review', label: 'review', jp: '復' },
  { route: 'sessions', label: 'sessions', jp: '記' },
  { route: 'words', label: 'words', jp: '語' },
  { route: 'settings', label: 'settings', jp: '設' },
];

interface BottomTabsProps {
  current: Route;
  onSelect: (route: Route) => void;
}

export function BottomTabs({ current, onSelect }: BottomTabsProps) {
  return (
    <nav
      // Fixed-bottom; bg uses backdrop-blur for the translucent depth that
      // reads as native-iOS without copying any specific control. The hairline
      // border on top is the only structural seam — bg is a slightly higher
      // surface tone than the page so it feels like a layered card.
      className="
        md:hidden
        fixed inset-x-0 bottom-0 z-40
        border-t border-border/60
        bg-surface/85 backdrop-blur-md
        pb-[env(safe-area-inset-bottom,0px)]
      "
      aria-label="Primary navigation"
    >
      <ul className="flex items-stretch">
        {NAV.map((item) => {
          const active = item.route === current;
          return (
            <li key={item.route} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(item.route)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'group w-full flex flex-col items-center justify-center gap-0.5',
                  'px-2 pt-2.5 pb-2',
                  'transition-[color,transform] duration-150 ease-out-strong',
                  'active:scale-[0.94]',
                  'focus-visible:outline-none',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'font-display text-[19px] leading-none tracking-tighter transition-colors duration-150',
                    active ? 'text-accent' : 'text-muted-foreground/70',
                  )}
                  aria-hidden
                >
                  {item.jp}
                </span>
                <span
                  className={cn(
                    'text-[9.5px] tracking-widest lowercase leading-none mt-1',
                    active ? 'text-foreground' : 'text-muted-foreground/80',
                  )}
                >
                  {item.label}
                </span>
                {/* Active indicator: a 3px cinnabar pip just under the kanji.
                    Reserves the space at all times so the layout doesn't
                    jump on tab change. */}
                <span
                  className={cn(
                    'mt-1 h-[3px] w-[3px] rounded-full transition-colors duration-150',
                    active ? 'bg-accent' : 'bg-transparent',
                  )}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
