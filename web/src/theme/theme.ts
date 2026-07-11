export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'dark-violet', label: 'Dark Violet' },
  { id: 'light-emerald', label: 'Light Emerald' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'th-theme';

export function getTheme(): ThemeId {
  const t = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as ThemeId | null;
  return THEMES.some((x) => x.id === t) ? (t as ThemeId) : 'light';
}

export function setTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** Read the resolved semantic colors from the active theme (for forwarding to plugins/charts). */
export function themeVars(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const names = ['bg', 'surface', 'surface-2', 'fg', 'muted', 'border', 'primary', 'pass', 'fail', 'error', 'skip'];
  const out: Record<string, string> = {};
  for (const n of names) out[n] = s.getPropertyValue(`--th-${n}`).trim();
  return out;
}
