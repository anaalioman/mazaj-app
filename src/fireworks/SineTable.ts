/**
 * Pre-computed sine lookup table with linear interpolation between samples,
 * built once at module load. `Particle.ts`'s per-frame, per-particle
 * twinkle flicker reads from this instead of calling `Math.sin()` directly.
 */
const TABLE_SIZE = 720; // 0.5° resolution — fine enough that interpolation error is visually imperceptible
export const TWO_PI = Math.PI * 2;

const table = new Float32Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) {
  table[i] = Math.sin((i / TABLE_SIZE) * TWO_PI);
}

/**
 * Table lookup + linear interpolation between the two nearest samples.
 * Unlike `Math.sin`, this does NOT wrap its input — the caller must already
 * be passing an angle in `[0, TWO_PI)` (see `Particle.ts`'s own
 * `twinkleTimer`, which wraps itself incrementally via a single `if` instead
 * of a `%` every frame). Passing an out-of-range value reads outside the
 * table's true wave and returns a wrong result.
 */
export function fastSin(wrappedRadians: number): number {
  const scaled = (wrappedRadians / TWO_PI) * TABLE_SIZE;
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const next = (index + 1) % TABLE_SIZE; // safe: integers bounded by TABLE_SIZE, not the caller's raw angle

  return table[index] + (table[next] - table[index]) * frac;
}

/** cos(x) = sin(x + π/2) — same table, same input contract (caller pre-wraps to [0, TWO_PI)). */
export function fastCos(wrappedRadians: number): number {
  let shifted = wrappedRadians + Math.PI / 2;
  if (shifted >= TWO_PI) shifted -= TWO_PI;
  return fastSin(shifted);
}
