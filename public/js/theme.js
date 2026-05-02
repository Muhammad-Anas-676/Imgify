// public/js/theme.js
// ES Module — must run in <head> via <script type="module">
// Zero dependencies beyond ./config.js

import { THEME_KEY } from './config.js';

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <circle cx="12" cy="12" r="4"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="22"/>
  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
  <line x1="2" y1="12" x2="6" y2="12"/>
  <line x1="18" y1="12" x2="22" y2="12"/>
  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
</svg>`;

const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`;

// ─── Core: apply theme synchronously (runs immediately on import) ─────────────

function _resolveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function _applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ← Runs synchronously on module parse — zero FOUC
_applyTheme(_resolveTheme());

// ─── Update toggle button UI ──────────────────────────────────────────────────

function _syncButton(btn, theme) {
  if (!btn) return;
  const isDark = theme === 'dark';
  btn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
  btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

// ─── Public API ───────────────────────────────────────────────────────────────

let _initialized = false;

export function initTheme() {
  if (_initialized) return; // idempotent
  _initialized = true;

  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const current = document.documentElement.getAttribute('data-theme') || _resolveTheme();
  _syncButton(btn, current);

  btn.addEventListener('click', toggleTheme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || _resolveTheme();
  const next = current === 'dark' ? 'light' : 'dark';

  _applyTheme(next);
  localStorage.setItem(THEME_KEY, next);

  const btn = document.getElementById('theme-toggle');
  _syncButton(btn, next);
}

export default { initTheme, toggleTheme };