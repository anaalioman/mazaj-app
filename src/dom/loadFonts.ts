import { Assets } from 'pixi.js';

// Self-hosted Tajawal (Arabic subset), SIL OFL 1.1 — see /public/fonts/.
// Loaded through Pixi's own Assets pipeline (its built-in "web-font" loader
// parser, see node_modules/pixi.js/lib/assets/loader/parsers/loadWebFont.js)
// rather than a hand-rolled FontFace call — same underlying browser API,
// but routed through PixiJS's native asset system instead of bypassing it.
// Not awaited by the caller (fire-and-forget), matching the old
// `font-display: swap` behaviour: the UI renders immediately with the
// fallback stack and swaps to Tajawal the moment each weight finishes
// loading.
const TAJAWAL_WEIGHTS = ['400', '500', '700', '800'] as const;

let readyPromise: Promise<void> | null = null;

/**
 * Memoized: main.ts's own fire-and-forget call and any later `await
 * loadTajawalFonts()` (see CharacterReveal.ts) share the exact same
 * in-flight/resolved promise rather than issuing a second redundant load.
 * Callers that only need the DOM-visible swap-in behavior (every panel's
 * own Text) can keep firing-and-forgetting this exactly as before; callers
 * that are about to permanently bake text into a texture (a one-time,
 * irreversible rasterization — see CharacterReveal.play()) must await it
 * first, since a bake that runs mid-load would freeze in the fallback font
 * forever, with no swap-in possible after the fact.
 */
export function loadTajawalFonts(): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.all(
      TAJAWAL_WEIGHTS.map((weight) =>
        Assets.load({
          alias: [`tajawal-${weight}`],
          src: `/fonts/tajawal-${weight}.woff2`,
          data: { family: 'Tajawal', weights: [weight], style: 'normal', display: 'swap' },
        }),
      ),
    ).then(() => undefined);
  }
  return readyPromise;
}
