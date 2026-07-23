import { lerpColor } from './Particle';

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

/**
 * `rand` defaults to `Math.random` for any caller outside the fireworks
 * pattern functions (none currently exist), but every pattern file
 * (Peony.ts, Rose.ts, ...) passes its own table-backed `nextRandom` here
 * instead — otherwise this one-draw-per-burst color pick would be the only
 * live `Math.random()` call left in an otherwise fully table-driven burst.
 */
export function randomPalette(rand: () => number = Math.random): number[] {
  return PALETTES[(rand() * PALETTES.length) | 0];
}

export function randomColor(palette: number[], rand: () => number = Math.random): number {
  return palette[(rand() * palette.length) | 0];
}

/** Picks a random palette guaranteed to differ from `exclude`, for real color contrast (e.g. Peony's outer sphere vs. its pistil core). */
export function contrastingPalette(exclude: number[], rand: () => number = Math.random): number[] {
  let palette = randomPalette(rand);
  let guard = 0;
  while (palette === exclude && guard++ < 5) palette = randomPalette(rand);
  return palette;
}

const ALL_COLORS = Array.from(new Set(PALETTES.flat()));

/** Picks `count` distinct colors at random across every palette, so a single
 * burst is guaranteed to show several different hues instead of one tone. */
export function pickBurstColors(count: number, rand: () => number = Math.random): number[] {
  const pool = [...ALL_COLORS];
  const picked: number[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = (rand() * pool.length) | 0;
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

/**
 * The player-facing "dye this shell" color picker (see PlanningScreen's color
 * panel). `hex: null` is the "متعدد الألوان / مكس" choice — it means "no
 * forced color", i.e. FireworksSystem falls back to its normal random
 * palettes. Every other entry is a single named hue applied to the whole
 * shell (see FireworksSystem's `activeColor` and `shadesOf()` below).
 */
export interface NamedColorChoice {
  id: string;
  label: string;
  hex: number | null;
}

export const COLOR_CHOICES: NamedColorChoice[] = [
  { id: 'red', label: 'الأحمر', hex: 0xff2d2d },
  { id: 'phosphorGreen', label: 'الأخضر الفسفوري', hex: 0x39ff6a },
  { id: 'cobaltBlue', label: 'الأزرق الكوبالتي', hex: 0x1e6bff },
  { id: 'royalGold', label: 'الذهبي الملكي', hex: 0xffd700 },
  { id: 'brightYellow', label: 'الأصفر الساطع', hex: 0xfff23d },
  { id: 'pearlWhite', label: 'الأبيض اللؤلؤي', hex: 0xf3ecdd },
  { id: 'crystalSilver', label: 'الفضي البلوري', hex: 0xd7e6ee },
  { id: 'fieryOrange', label: 'البرتقالي المشتعل', hex: 0xff5a1f },
  { id: 'royalPurple', label: 'البنفسجي الملكي', hex: 0x9a3dff },
  { id: 'hotPink', label: 'الوردي الفاقع', hex: 0xff2ecb },
  { id: 'strobeSilver', label: 'الأبيض الفضي البراق', hex: 0xeaf6ff },
  { id: 'multi', label: 'متعدد الألوان', hex: null },
];

/** Lightness-varied shades of one hue — lets a forced-color burst still show
 * a bit of tonal variety across its sparks instead of one flat identical
 * value everywhere, while staying clearly recognizable as "that color". */
export function shadesOf(hex: number, count = 3): number[] {
  const shades: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : (i / (count - 1)) * 0.45;
    shades.push(lerpColor(hex, 0xffffff, t));
  }
  return shades;
}
