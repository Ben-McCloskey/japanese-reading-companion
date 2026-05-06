import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/sidebar';
import { ReadPage } from './pages/read';
import { ReviewPage } from './pages/review';
import { SessionsPage } from './pages/sessions';
import { WordsPage } from './pages/words';
import { SettingsPage } from './pages/settings';
import { SetupPage } from './pages/setup';
import { useDictStatus } from './lib/dict-status';
import type { Route } from './types/route';

export function App() {
  const [route, setRoute] = useState<Route>('read');
  const [pendingSessionId, setPendingSessionId] = useState<number | null>(null);
  const { status: dictStatus } = useDictStatus();

  const openSession = useCallback((id: number) => {
    setPendingSessionId(id);
    setRoute('read');
  }, []);

  const consumePendingSession = useCallback(() => {
    setPendingSessionId(null);
  }, []);

  // Cmd/Ctrl+1..5 — switch sidebar section
  useEffect(() => {
    const navMap: Record<string, Route> = {
      '1': 'read',
      '2': 'review',
      '3': 'sessions',
      '4': 'words',
      '5': 'settings',
    };
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const next = navMap[e.key];
      if (!next) return;
      e.preventDefault();
      setRoute(next);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Avoid flashing the main app while we're still asking main for the
  // dictionary status on first paint.
  if (dictStatus.kind === 'unknown') {
    return <div className="h-full bg-background" />;
  }

  const needsSetup =
    dictStatus.kind === 'needs-import' ||
    dictStatus.kind === 'importing' ||
    dictStatus.kind === 'failed';

  if (needsSetup) {
    return (
      <div className="flex h-full overflow-hidden bg-background text-foreground">
        <main className="flex-1 min-w-0">
          <SetupPage
            status={dictStatus}
            onImport={() => {
              void window.api.importDict();
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <Sidebar current={route} onSelect={setRoute} />
      <main className="flex-1 min-w-0">
        {route === 'read' ? (
          <ReadPage
            pendingSessionId={pendingSessionId}
            onConsumePendingSession={consumePendingSession}
          />
        ) : null}
        {route === 'review' ? <ReviewPage /> : null}
        {route === 'sessions' ? (
          <SessionsPage onOpenSession={openSession} />
        ) : null}
        {route === 'words' ? <WordsPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  );
}
