import { useCallback, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'ai-canvas-theme';
const LEGACY_THEME_STORAGE_KEY = 'theme';

const isThemeMode = (value: string | null): value is ThemeMode => (
  value === 'dark' || value === 'light' || value === 'system'
);

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const resolveTheme = (mode: ThemeMode): ResolvedTheme => (
  mode === 'system' ? getSystemTheme() : mode
);

const getStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : 'dark';
};

const applyTheme = (mode: ThemeMode) => {
  if (typeof document === 'undefined') return resolveTheme(mode);
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
};

export const useTheme = () => {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme(getStoredTheme()));

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => setResolvedTheme(applyTheme('system'));
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (resolveTheme(current) === 'dark' ? 'light' : 'dark'));
  }, []);

  const isDark = resolvedTheme === 'dark';

  const reactFlowTheme = useMemo(() => (
    isDark
      ? {
          background: '#0d0f17',
          minimapNode: '#24283a',
          minimapStroke: '#6366f1',
          minimapMask: 'rgba(0, 0, 0, 0.42)',
          edge: '#354056',
        }
      : {
          background: '#d9dde7',
          minimapNode: '#ffffff',
          minimapStroke: '#4f46e5',
          minimapMask: 'rgba(100, 116, 139, 0.16)',
          edge: '#4f46e5',
        }
  ), [isDark]);

  return {
    theme,
    resolvedTheme,
    isDark,
    setTheme,
    toggleTheme,
    reactFlowTheme,
  };
};
