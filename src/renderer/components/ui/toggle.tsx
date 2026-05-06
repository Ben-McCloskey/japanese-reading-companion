import { cn } from '@renderer/lib/cn';

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
}: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full',
        'border border-border/70',
        'transition-colors duration-200 ease-out-strong',
        'active:scale-[0.97] [transition-property:background-color,transform,border-color]',
        checked ? 'bg-accent border-accent' : 'bg-muted/60',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-background shadow-sm',
          'transition-transform duration-200 ease-out-strong',
          checked ? 'translate-x-[22px]' : 'translate-x-1',
        )}
      />
    </button>
  );
}
