'use client';

import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'zos_theme';
const THEME_CHANGE_EVENT = 'zos-theme-change';

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function getThemeSnapshot(): Theme {
  return document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}

function getServerThemeSnapshot(): Theme {
  return 'dark';
}

function subscribeToTheme(onStoreChange: () => void) {
  function handleThemeChange() {
    onStoreChange();
  }

  function handleStorage(event: StorageEvent) {
    if (
      event.key !== THEME_STORAGE_KEY ||
      (event.newValue !== 'light' && event.newValue !== 'dark')
    ) {
      return;
    }

    applyTheme(event.newValue);
    onStoreChange();
  }

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';

    applyTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const nextThemeLabel = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextThemeLabel} mode`}
      title={`Switch to ${nextThemeLabel} mode`}
      className="fixed bottom-5 right-5 z-[100] inline-flex h-11 items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3.5 text-sm font-semibold text-slate-200 shadow-2xl shadow-black/20 backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
      <span className="hidden sm:inline">
        {theme === 'dark' ? 'Dark mode' : 'Light mode'}
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 text-amber-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.42 1.42" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 text-cyan-300"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}