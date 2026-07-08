/**
 * Small hand-authored line icons (24x24, stroke-based — same visual language
 * as Lucide/Heroicons) used everywhere the app previously relied on emoji as
 * functional UI glyphs. No icon-font/library dependency; each is just an
 * inline SVG string sized via `size` and colored via `currentColor`.
 */

const PATHS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
  target: '<circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="3.8"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/>',
  rocket:
    '<path d="M12 2.2c2.4 2.4 3.8 5.8 3.8 9.6 0 1.9-.7 3.6-1.9 5L12 18.8l-1.9-2c-1.2-1.4-1.9-3.1-1.9-5 0-3.8 1.4-7.2 3.8-9.6Z"/><circle cx="12" cy="10" r="1.4"/><path d="M8.3 13.7 6 16M15.7 13.7 18 16M10 18.8l-.4 2.6M14 18.8l.4 2.6"/>',
  volume2: '<path d="M4 9.2v5.6h3.6l4.6 3.7V5.5L7.6 9.2H4Z"/><path d="M16 8.4a4.6 4.6 0 0 1 0 7.2M18.6 6a8.2 8.2 0 0 1 0 12"/>',
  volumeX: '<path d="M4 9.2v5.6h3.6l4.6 3.7V5.5L7.6 9.2H4Z"/><path d="M15.5 9.3l4.8 5.4M20.3 9.3l-4.8 5.4"/>',
  camera:
    '<path d="M4 8.2h2.3l1.2-1.9h8.4l1.2 1.9H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.6" r="3.1"/>',
  recordDot: '<circle cx="12" cy="12" r="6.8" fill="currentColor" stroke="none"/>',
  squareStop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  shuffle:
    '<path d="M4 6.5h3.2c1.8 0 3.4 1 4.3 2.6l1 1.8M4 17.5h3.2c1.8 0 3.4-1 4.3-2.6l1-1.8"/><path d="M15 5.8h4.5v4.4M15 18.2h4.5v-4.4"/>',
  sparkles:
    '<path d="M12 3l1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3Z"/><path d="M19 15.2l.6 2.2 2.2.6-2.2.6-.6 2.2-.6-2.2-2.2-.6 2.2-.6.6-2.2Z"/>',
  play: '<path d="M6.5 4.6v14.8L19 12 6.5 4.6Z"/>',
  shapes:
    '<rect x="3" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/>',
  mountain: '<path d="M3 19 9 8l4 6 2-3 6 8Z"/><circle cx="17.2" cy="6" r="1.5"/>',
  messageSquare:
    '<path d="M4.5 5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9.5L5 19.5V16H4.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  sliders:
    '<path d="M4 6.5h5.5M13.5 6.5H20M4 12h1.5M9.5 12H20M4 17.5h9.5M17.5 17.5H20"/><circle cx="11.5" cy="6.5" r="2"/><circle cx="7.5" cy="12" r="2"/><circle cx="15.5" cy="17.5" r="2"/>',
  fireworksMood:
    '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.9 2-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.7-.5-1.2 0-.8.7-1.4 1.4-1.4H16a4 4 0 0 0 4-4c0-4.5-4-8.2-8-8.2Z"/><circle cx="7.6" cy="10.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
  vibrate: '<path d="M3 9.5v5M6 6v12M18 6v12M21 9.5v5"/><rect x="8.7" y="5" width="6.6" height="14" rx="1.6"/>',
  gem: '<path d="M6.2 3h11.6l3 5.3L12 21 2.2 8.3 6.2 3Z"/><path d="M2.2 8.3h19.6M9.2 3 6.8 8.3 12 21M14.8 3l2.4 5.3L12 21"/>',
  waves:
    '<path d="M2 8.2c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0 2.9 1.4 4.3 0"/><path d="M2 14c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0 2.9 1.4 4.3 0"/><path d="M2 19.8c1.4-1.4 2.9-1.4 4.3 0s2.9 1.4 4.3 0 2.9-1.4 4.3 0 2.9 1.4 4.3 0"/>',
  pendulum: '<path d="M6 4h12"/><path d="M8 4c0 5 3 6 8 11.5"/><circle cx="16.5" cy="17" r="2.6"/>',
  droplet: '<path d="M12 3c3.6 4.5 6.2 8.2 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 11.2 8.4 7.5 12 3Z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): string {
  return `<svg class="mzj-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}
