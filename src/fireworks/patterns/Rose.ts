import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE } from '../SineTable';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;

// Static pre-computed randomness pool, built once at module load. Walked
// with a fixed stride (not +1) that's coprime with the table size, so the
// index sequence visits all RANDOM_TABLE_SIZE slots before repeating any —
// verified numerically: zero repeats within 900 draws, comfortably above
// the ~876-draw ceiling a single max-density Rose burst can reach (up to
// ~219 particles * 4 draws each). Starting offset is randomized per burst
// (one live Math.random() call) so consecutive bursts don't replay the
// same slice of the pool in the same order.
const RANDOM_TABLE_SIZE = 1024;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 7; // coprime with 1024 (power of 2) — full-period walk
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

/**
 * Polar rose burst: initial velocity follows `r = cos(k*theta)`, so as
 * particles fly outward in straight lines the expanding pattern traces a
 * k-petaled rose curve (negative r flips through the origin, which is
 * exactly how the classic rose curve handles it) — real polar-curve math,
 * evaluated once per particle in the ticker-driven spawn loop, entirely in
 * `SineTable`'s integer index space (`fastSinByIndex`/`fastCosByIndex`):
 * theta and k*theta are wrapped via `& TABLE_MASK` instead of a radian-based
 * subtraction loop, so there's no branch and no live `Math.cos`/`sin`.
 */
export function burstRose(x: number, y: number, ctx: BurstContext): void {
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(3 + Math.floor(Math.random() * 3));
  const k = 2 + Math.floor(Math.random() * 5);
  // Back to the same base count every other pattern uses proportionally
  // (was temporarily cut to 100 to manage spawn-loop CPU cost before
  // FireworksSystem.ts had a real object pool — see its `deadPool` doc
  // comment — which removed that pressure; no reason for Rose to be the
  // one thin-looking pattern now that the actual cost problem is fixed).
  const count = Math.max(20, Math.round(140 * ctx.densityRatio));
  const baseSpeed = (3.4 + Math.random() * 1.6) * ctx.settings.explosionScale;
  const colorsLength = burstColors.length;

  let rIdx = Math.floor(Math.random() * RANDOM_TABLE_SIZE);

  for (let i = 0; i < count; i++) {
    const thetaIndex = Math.floor((i / count) * TABLE_SIZE) & TABLE_MASK;
    const petalIndex = (k * thetaIndex) & TABLE_MASK;
    // Exact r * baseSpeed, no per-particle variance — every spark lands
    // precisely on the mathematical rose curve instead of scattered ±10%
    // around it.
    const r = fastCosByIndex(petalIndex);
    const speed = r * baseSpeed;
    const cosT = fastCosByIndex(thetaIndex);
    const sinT = fastSinByIndex(thetaIndex);

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const randColor = randomTable[rIdx];
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const randSize = randomTable[rIdx];
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const randLife = randomTable[rIdx];
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const randTwin = randomTable[rIdx];

    const color = burstColors[Math.floor(randColor * colorsLength)];

    ctx.spawn({
      x,
      y,
      vx: cosT * speed,
      vy: sinT * speed,
      color,
      size: (7 + randSize * 5) * ctx.glowSizeBoost,
      life: (60 + randLife * 40) * ctx.settings.lifespanScale,
      gravity: 0.08 * ctx.settings.gravityScale,
      drag: 0.978,
      twinkle: randTwin < 0.25,
    });
  }
}
