// Curated color palettes so a single burst reads as one coherent firework
// instead of random unrelated colors.
export const PALETTES: number[][] = [
  [0xff5555, 0xffb347, 0xffe066], // ember
  [0x5ad1ff, 0x7cf5ff, 0xffffff], // ice
  [0xff5ecb, 0xff8adf, 0xc06bff], // magenta bloom
  [0x7dffb3, 0x36f1cd, 0xffffff], // emerald
  [0xffd23f, 0xffffff, 0xff5e5e], // gold
  [0xb388ff, 0x8c9eff, 0xffffff], // violet
  [0xff9f45, 0xffffff, 0xffe066], // amber
  [0x1e6bff, 0x3a86ff, 0x0f3d91], // cobalt blue
];

export function randomPalette(): number[] {
  return PALETTES[Math.floor(Math.random() * PALETTES.length)];
}

export function randomColor(palette: number[]): number {
  return palette[Math.floor(Math.random() * palette.length)];
}

const ALL_COLORS = Array.from(new Set(PALETTES.flat()));

/** Picks `count` distinct colors at random across every palette, so a single
 * burst is guaranteed to show several different hues instead of one tone. */
export function pickBurstColors(count: number): number[] {
  const pool = [...ALL_COLORS];
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}
