/**
 * Pre-computed sine lookup table with linear interpolation between samples,
 * built once at module load. `Particle.ts`'s per-frame, per-particle
 * twinkle flicker reads from this instead of calling `Math.sin()` directly.
 */
export const TABLE_SIZE = 1024; // power of 2 — enables `& (TABLE_SIZE - 1)` instead of `% TABLE_SIZE`
const TABLE_MASK = TABLE_SIZE - 1;
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
  const index = scaled | 0; // truncation toward zero == Math.floor for scaled >= 0
  const frac = scaled - index;
  const next = (index + 1) & TABLE_MASK; // valid since TABLE_SIZE is a power of 2 and index+1 >= 0

  return table[index] + (table[next] - table[index]) * frac;
}

/** cos(x) = sin(x + π/2) — same table, same input contract (caller pre-wraps to [0, TWO_PI)). */
export function fastCos(wrappedRadians: number): number {
  let shifted = wrappedRadians + Math.PI / 2;
  if (shifted >= TWO_PI) shifted -= TWO_PI;
  return fastSin(shifted);
}

/**
 * Direct table lookup by INTEGER index (0..TABLE_SIZE-1), not radians — for
 * callers that already work in table-index space (e.g. Rose.ts's polar
 * angle steps) and want to wrap via `& (TABLE_SIZE - 1)` instead of
 * converting back to radians and re-scaling through `fastSin`. No
 * interpolation (plain lookup), so this trades a little precision for one
 * array read + one mask, no division/branch.
 */
export function fastSinByIndex(index: number): number {
  return table[index & TABLE_MASK];
}

/** `fastCosByIndex` — see `fastSinByIndex`; cos is sin shifted a quarter-table (TABLE_SIZE/4 == 90°). */
export function fastCosByIndex(index: number): number {
  return table[(index + TABLE_SIZE / 4) & TABLE_MASK];
}
