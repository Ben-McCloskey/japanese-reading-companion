import { cn } from '@renderer/lib/cn';
import { speakJapanese, useTts } from '@renderer/lib/tts';

interface SpeakerButtonProps {
  text: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact speaker icon. Disabled (with a tooltip) when no Japanese voice is
 * installed on the OS. Uses Web Speech API directly — no main-process round-trip.
 */
export function SpeakerButton({
  text,
  size = 'md',
  className,
}: SpeakerButtonProps) {
  const tts = useTts();
  const ready = tts.kind === 'ready';

  const title =
    tts.kind === 'ready'
      ? `Pronounce — ${tts.voice.name}`
      : tts.kind === 'no-japanese-voice'
        ? 'No Japanese voice installed on this device'
        : tts.kind === 'unsupported'
          ? 'Speech synthesis is unavailable'
          : 'Loading voices…';

  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const iconSize = size === 'sm' ? 14 : 16;

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!ready) return;
    speakJapanese(text, tts.voice);
  }

  return (
    <button
      type="button"
      aria-label="Pronounce"
      title={title}
      onClick={onClick}
      disabled={!ready}
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        dim,
        'border border-border/70 text-muted-foreground',
        'transition-[background-color,color,transform] duration-150 ease-out-strong',
        'hover:text-foreground hover:bg-muted/40',
        'active:scale-[0.92]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:bg-muted/40',
        className,
      )}
    >
      <SpeakerIcon size={iconSize} />
    </button>
  );
}

function SpeakerIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 6.5h2.5L8 3.5v9L4.5 9.5H2v-3z" />
      <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
      <path d="M12.8 3.7a6 6 0 0 1 0 8.6" />
    </svg>
  );
}
