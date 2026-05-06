import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, loadInitialTheme } from './lib/theme';
import './styles/globals.css';

async function bootstrap() {
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
