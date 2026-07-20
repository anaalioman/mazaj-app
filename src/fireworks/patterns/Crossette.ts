import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE, TWO_PI } from '../SineTable';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;
// Converts a small radian jitter into the same table's index units, so it
// can be added directly to an already-integer base index before masking.
const JITTER_TO_INDEX = TABLE_SIZE / TWO_PI;

// Static pre-computed randomness pool, built once at module load — same
// technique as Rose.ts's own pool (see its doc comment for the coprime-
// stride proof). One shared advancing index per burst covers the arm loop,
// every arm-trail tick (`onSparkle`, spread across the arm's ~55-75 frame
// life), and every split, so a single dense burst's total draw count stays
// well under the 1024-slot period.
const RANDOM_TABLE_SIZE = 1024;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 7; // coprime with 1024 (power of 2) — full-period walk
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// Fast inverse square root: the classic bit-level approximation (one
// Newton-Raphson refinement step) — same technique as Quake III's
// 0x5f3759df trick. Verified numerically: max relative error 0.175% over
// realistic spark velocity magnitudes (0.1-20). The scratch buffer is
// hoisted to module scope so the float/int reinterpret-cast allocates
// nothing per call.
const invSqrtBuf = new ArrayBuffer(4);
const invSqrtF32 = new Float32Array(invSqrtBuf);
const invSqrtI32 = new Int32Array(invSqrtBuf);
function fastInvSqrt(x: number): number {
  invSqrtF32[0] = x;
  invSqrtI32[0] = 0x5f3759df - (invSqrtI32[0] >> 1);
  const y = invSqrtF32[0];
  return y * (1.5 - 0.5 * x * y * y);
}

/**
 * Palm Tree Crossette: 5-7 thick arms fired from center like fronds; each
 * arm trails its own dust (`onSparkle`) and, right at the end of its life,
 * splits into two sparks fired opposite each other, perpendicular to the
 * arm (`onSplit`) instead of continuing straight.
 *
 * Arm directions are computed entirely in `SineTable`'s integer index space
 * (`fastCosByIndex`/`fastSinByIndex`), including the per-arm jitter (a
 * radian offset converted into index units and added before masking) — no
 * live `Math.cos`/`Math.sin`. The split direction is exact perpendicular-
 * vector algebra (rotating (svx, svy) by ±90° is just (∓svy, ±svx)); its
 * normalization uses `fastInvSqrt` instead of `Math.hypot`, since a linear
 * magnitude can only come from *some* square root — this one just avoids
 * the native call in favor of a verified bit-level approximation.
 */
export function burstPalmCrossette(x: number, y: number, ctx: BurstContext): void {
  let rIdx = Math.floor(Math.random() * RANDOM_TABLE_SIZE);
  const nextRandom = (): number => {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[rIdx];
  };

  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 3) : pickBurstColors(3);
  const armCount = 5 + Math.floor(nextRandom() * 3); // 5, 6, or 7
  const baseSpeed = (3.0 + nextRandom() * 1.4) * ctx.settings.explosionScale;

  // Down to 3 draws per trail tick (from 6): each is reused for a second,
  // visually-correlated field (position jitter doubles as its matching
  // velocity-jitter component, size doubles as life) — imperceptible for a
  // one-frame dust speck, and cuts this the most frequently-called closure
  // in the file to half its random draws.
  const spawnArmTrail = (sx: number, sy: number, color: number): void => {
    const r1 = nextRandom();
    const r2 = nextRandom();
    const r3 = nextRandom();
    ctx.spawn({
      x: sx + (r1 - 0.5) * 3,
      y: sy + (r2 - 0.5) * 3,
      vx: (r1 - 0.5) * 0.3,
      vy: 0.1 + r2 * 0.2,
      color,
      size: 3 + r3 * 2,
      life: (16 + r3 * 10) * ctx.settings.lifespanScale,
      gravity: 0.03 * ctx.settings.gravityScale,
      drag: 0.97,
    });
  };

  const spawnSplit = (sx: number, sy: number, svx: number, svy: number, color: number): void => {
    const magSq = svx * svx + svy * svy;
    const invMag = magSq > 1e-12 ? fastInvSqrt(magSq) : 0;
    const mag = magSq * invMag; // magSq * (1/sqrt(magSq)) == sqrt(magSq) — same one approximation, no second sqrt
    const speed = Math.max(mag * 0.7, 1.6);

    // Two sparks perpendicular to the arm's own direction — 180° apart from
    // each other. Rotating (svx, svy) by +90°/-90° is exactly
    // (-svy, svx) / (svy, -svx) — no angle, no trig, no temporary array
    // (two explicit spawn calls with plain local scalars instead of a loop
    // over an array literal).
    const perp1x = -svy * invMag;
    const perp1y = svx * invMag;
    const perp2x = svy * invMag;
    const perp2y = -svx * invMag;

    ctx.spawn({
      x: sx,
      y: sy,
      vx: perp1x * speed,
      vy: perp1y * speed,
      color,
      size: (6 + nextRandom() * 3) * ctx.glowSizeBoost,
      life: (26 + nextRandom() * 16) * ctx.settings.lifespanScale,
      gravity: 0.12 * ctx.settings.gravityScale,
      drag: 0.98,
      twinkle: true,
    });
    ctx.spawn({
      x: sx,
      y: sy,
      vx: perp2x * speed,
      vy: perp2y * speed,
      color,
      size: (6 + nextRandom() * 3) * ctx.glowSizeBoost,
      life: (26 + nextRandom() * 16) * ctx.settings.lifespanScale,
      gravity: 0.12 * ctx.settings.gravityScale,
      drag: 0.98,
      twinkle: true,
    });
  };

  for (let i = 0; i < armCount; i++) {
    const baseIndex = Math.round((i / armCount) * TABLE_SIZE);
    const jitterIndex = Math.round((nextRandom() - 0.5) * 0.15 * JITTER_TO_INDEX);
    const thetaIndex = (baseIndex + jitterIndex) & TABLE_MASK;
    const speed = baseSpeed * (0.85 + nextRandom() * 0.3);
    const color = burstColors[Math.floor(nextRandom() * burstColors.length)];
    const life = (55 + nextRandom() * 20) * ctx.settings.lifespanScale;

    ctx.spawn({
      x,
      y,
      vx: fastCosByIndex(thetaIndex) * speed,
      vy: fastSinByIndex(thetaIndex) * speed,
      color,
      size: (15 + nextRandom() * 6) * ctx.glowSizeBoost, // thick frond
      life,
      gravity: 0.09 * ctx.settings.gravityScale,
      drag: 0.99,
      sparkleInterval: 2 + nextRandom() * 2,
      onSparkle: (sx, sy) => spawnArmTrail(sx, sy, color),
      splitAt: life * 0.94, // right at the tip of the arm's life
      onSplit: (sx, sy, svx, svy) => spawnSplit(sx, sy, svx, svy, color),
    });
  }
}
