import { api } from '@platform';

export type Theme = 'light' | 'dark';

const SETTING_KEY = 'theme';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

export async function loadInitialTheme(): Promise<Theme> {
  const res = await api.getSetting(SETTING_KEY);
  if (res.ok && isTheme(res.data)) return res.data;
  return 'dark';
}

export async function persistTheme(theme: Theme): Promise<void> {
  await api.setSetting(SETTING_KEY, theme);
}
