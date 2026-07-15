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

export async function loadTajawalFonts(): Promise<void> {
  await Promise.all(
    TAJAWAL_WEIGHTS.map((weight) =>
      Assets.load({
        alias: [`tajawal-${weight}`],
        src: `/fonts/tajawal-${weight}.woff2`,
        data: { family: 'Tajawal', weights: [weight], style: 'normal', display: 'swap' },
      }),
    ),
  );
}
