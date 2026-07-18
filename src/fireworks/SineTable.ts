/**
 * Pre-computed sine lookup table with linear interpolation between samples,
 * built once at module load. `Particle.ts`'s per-frame, per-particle
 * twinkle flicker reads from this instead of calling `Math.sin()` directly.
 */
const TABLE_SIZE = 720; // 0.5° resolution — fine enough that interpolation error is visually imperceptible
const TWO_PI = Math.PI * 2;

const table = new Float32Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) {
  table[i] = Math.sin((i / TABLE_SIZE) * TWO_PI);
}

/** Same domain/range as `Math.sin` — table lookup + linear interpolation between the two nearest samples, with the input angle wrapped into [0, 2π) first. */
export function fastSin(radians: number): number {
  let angle = radians % TWO_PI;
  if (angle < 0) angle += TWO_PI;

  const scaled = (angle / TWO_PI) * TABLE_SIZE;
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const next = (index + 1) % TABLE_SIZE;

  return table[index] + (table[next] - table[index]) * frac;
}
