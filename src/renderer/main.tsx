import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, loadInitialTheme } from './lib/theme';
import { PLATFORM } from '@platform';
import './styles/globals.css';

async function bootstrap() {
  // Tag <html> so platform-specific CSS (macOS title spacer vs iOS safe-area
  // inset) can branch without React state.
  document.documentElement.dataset.platform = PLATFORM;

  // Apply persisted theme before first paint to avoid a flash.
  try {
    const theme = await loadInitialTheme();
    applyTheme(theme);
  } catch {
    applyTheme('dark');
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root');
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
