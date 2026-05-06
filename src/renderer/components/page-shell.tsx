import type { ReactNode } from 'react';

interface PageShellProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function PageShell({ eyebrow, title, subtitle, children }: PageShellProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="titlebar-drag h-11" />
      <div className="max-w-3xl mx-auto px-12 pb-16">
        <header className="pt-6 pb-10 border-b border-border/60">
          {eyebrow ? (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-display text-4xl tracking-tighter text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 text-sm text-muted-foreground max-w-prose leading-relaxed">
              {subtitle}
            </p>
          ) : null}
        </header>
        <div className="pt-10">{children}</div>
      </div>
    </div>
  );
}
