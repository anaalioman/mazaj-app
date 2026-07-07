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
];

export function randomPalette(): number[] {
  return PALETTES[Math.floor(Math.random() * PALETTES.length)];
}

export function randomColor(palette: number[]): number {
  return palette[Math.floor(Math.random() * palette.length)];
}
