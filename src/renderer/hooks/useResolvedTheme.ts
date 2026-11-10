import { useEffect, useState } from 'react';
import type { ResolvedTheme, ThemePreference } from '@shared/types/settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Resolves the theme preference and applies it to the document root. */
export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = (): void => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);

  return resolved;
}
