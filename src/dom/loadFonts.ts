// Self-hosted Tajawal (Arabic subset), SIL OFL 1.1 — see /public/fonts/.
// Inline replacement for the old fonts.css @font-face rules, via the
// standard FontFace API instead of a stylesheet. Not awaited by the
// caller (fire-and-forget), matching the old `font-display: swap`
// behaviour: the UI renders immediately with the fallback stack and swaps
// to Tajawal the moment each weight finishes loading.
const TAJAWAL_WEIGHTS = [400, 500, 700, 800] as const;

export async function loadTajawalFonts(): Promise<void> {
  await Promise.all(
    TAJAWAL_WEIGHTS.map(async (weight) => {
      const font = new FontFace('Tajawal', `url(/fonts/tajawal-${weight}.woff2) format('woff2')`, {
        weight: String(weight),
        style: 'normal',
        display: 'swap',
      });
      const loaded = await font.load();
      document.fonts.add(loaded);
    }),
  );
}
