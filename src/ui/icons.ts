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
  groundFountain:
    '<path d="M12 20c0-4.5-2.2-6.5-2.2-11.5M12 20c0-5.5 0-8 0-13M12 20c0-4.5 2.2-6.5 2.2-11.5"/><path d="M6 20h12"/>',
  mapPin: '<path d="M12 21S5 14.5 5 9a7 7 0 1 1 14 0c0 5.5-7 12-7 12Z"/><circle cx="12" cy="9" r="2.4"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" stroke="none"/><path d="M3 16.5 8 11l3.5 3.5 3-3L21 17"/>',
  arrowBack: '<path d="M11 5 4 12l7 7"/><path d="M4 12h16"/>',
  // Small schematic previews of each firework burst pattern, used on the
  // pattern-picker cards so the eye has a shape to read, not just text.
  peony:
    '<path d="M15.5 12h5M14.47 14.47l3.54 3.54M12 15.5v5M9.53 14.47l-3.54 3.54M8.5 12h-5M9.53 9.53 5.99 5.99M12 8.5v-5M14.47 9.53l3.54-3.54"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  rose:
    '<circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="1.1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  kamuro: '<path d="M12 12Q6 6 4 14M12 12Q9 4 8 15M12 12Q12 3 12 16M12 12Q15 4 16 15M12 12Q18 6 20 14"/>',
  crossette:
    '<path d="M12 12 12 5M12 5 10.3 3.3M12 5 13.7 3.3M12 12 19 12M19 12 20.7 10.3M19 12 20.7 13.7M12 12 12 19M12 19 10.3 20.7M12 19 13.7 20.7M12 12 5 12M5 12 3.3 10.3M5 12 3.3 13.7"/>',
  multiRing: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="8.6"/>',
  strobe:
    '<path d="M12 3l1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3Z"/><path d="M19 15.2l.6 2.2 2.2.6-2.2.6-.6 2.2-.6-2.2-2.2-.6 2.2-.6.6-2.2Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  // Composing-time mode icons (TextComposer's second icon row): a lit fuse
  // rope, an eraser trailing sparks, and a coiled spring — see that file's
  // own ComposeMode doc comment for what each mode actually does.
  fuse: '<path d="M3 20q4-4 2-8t3-8"/><path d="M14 2.5l1.3 3.2L18.5 7l-3.2 1.3L14 11.5l-1.3-3.2L9.5 7l3.2-1.3L14 2.5Z"/>',
  sparkEraser:
    '<rect x="3.3" y="12.5" width="12" height="7" rx="1.5" transform="rotate(-22 9.3 16)"/><path d="M18.5 4.5l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1 1-2.3Z"/><path d="M20 12.5l1.8 1.8M21.3 15.8l1.3 1.3"/>',
  spring: '<path d="M12 2.5v3M12 5.5 7 8l10 3-10 3 10 3-7 2.5M12 19.5V22"/>',
  cloud: '<path d="M7.5 18a4 4 0 0 1-1-7.87 4.5 4.5 0 0 1 8.55-2.62A5 5 0 0 1 21.5 12a3.5 3.5 0 0 1-.5 6H7.5Z"/>',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * A self-contained SVG document (own xmlns + a literal color instead of
 * `currentColor`, which only resolves via a CSS cascade the inline `icon()`
 * markup normally sits inside) — for rasterizing one of these exact icons
 * into a PixiJS texture. See ui/svgIconTexture.ts.
 */
export function standaloneIconSvg(name: IconName, size: number, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" color="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}
