import { useState } from 'react';
import { THEMES, getTheme, setTheme, type ThemeId } from './theme.js';

export function ThemeSwitcher() {
  const [theme, setThemeState] = useState<ThemeId>(getTheme());
  return (
    <select
      aria-label="Theme"
      value={theme}
      onChange={(e) => {
        const id = e.target.value as ThemeId;
        setTheme(id);
        setThemeState(id);
      }}
      className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg"
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
