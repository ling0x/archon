// =============================================================================
// Theme Management
// =============================================================================

import hljsDarkUrl from 'highlight.js/styles/github-dark.css?url';
import hljsLightUrl from 'highlight.js/styles/github.css?url';

export const THEME_STORAGE_KEY = 'archon-theme';
export type Theme = 'light' | 'dark';

let hljsLink: HTMLLinkElement | null = null;

function ensureHljsLink(): HTMLLinkElement {
  if (!hljsLink) {
    hljsLink = document.createElement('link');
    hljsLink.rel = 'stylesheet';
    hljsLink.id = 'hljs-theme';
    document.head.appendChild(hljsLink);
  }
  return hljsLink;
}

export function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // ignore
  }
  return null;
}

export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;

  const link = ensureHljsLink();
  link.href = theme === 'light' ? hljsLightUrl : hljsDarkUrl;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getEffectiveTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}

export function initTheme(): Theme {
  const theme = getEffectiveTheme();
  applyTheme(theme);
  return theme;
}

export function syncThemeToggleButton(btn: HTMLButtonElement, theme: Theme): void {
  const isLight = theme === 'light';
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  btn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.textContent = isLight ? '☾' : '☀';
}