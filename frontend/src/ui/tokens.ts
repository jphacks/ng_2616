'use client';

/**
 * Design tokens for code that draws outside CSS (canvas ink, browser chrome). The values
 * live in src/app/globals.css; this reads them as resolved colors, so a re-skin there reaches
 * the canvas too.
 */
export type ColorToken = `--color-${string}`;

const cache = new Map<ColorToken, string>();

/** The token's color as the browser resolves it (e.g. "rgb(26, 32, 48)"). */
export function tokenColor(name: ColorToken): string {
  let value = cache.get(name);
  if (value) return value;
  // custom properties keep var()/color-mix() unresolved; a probe element resolves them
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  value = getComputedStyle(probe).color;
  probe.remove();
  cache.set(name, value);
  return value;
}

/** Keeps the browser's theme color (iOS status bar, Android toolbar) on the paper token. */
export function syncThemeColor() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = tokenColor('--color-paper');
}
