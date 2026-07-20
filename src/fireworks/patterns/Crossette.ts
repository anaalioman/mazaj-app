import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE } from '../SineTable';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;
// Plain integer index-space jitter (no radians, no TWO_PI/Math.PI in the
// loop) — chosen to match the visual spread of the old ±0.075rad jitter
// (0.075/(2π)*1024 ≈ 12.2 steps either side), added directly to the base
// index before masking.
const ARM_JITTER_HALF_RANGE = 12;

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

/**
 * Palm Tree Crossette: 5-7 thick arms fired from center like fronds; each
 * arm trails its own dust (`onSparkle`) and, right at the end of its life,
 * splits into two sparks fired opposite each other, perpendicular to the
 * arm (`onSplit`) instead of continuing straight.
 *
 * Arm directions are computed entirely in `SineTable`'s integer index space
 * (`fastCosByIndex`/`fastSinByIndex`) — the per-arm jitter is a plain
 * integer index offset, not a radian value, so no `Math.PI` conversion
 * happens in the loop. The split direction is exact perpendicular-vector
 * algebra (rotating (svx, svy) by ±90° is just (∓svy, ±svx)); its
 * normalization divides by `Math.sqrt(magSq)` directly — measured faster
 * than a hand-rolled fast-inverse-sqrt bit-trick in this engine (V8: native
 * sqrt ~286ms vs the bit-trick's ~321ms over 20M calls), so the trick bought
 * nothing here and is gone.
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

  // 4 fully independent draws per trail tick, one per field — position
  // jitter (x, y) and velocity (vx, vy) each get their own value, so a
  // speck's spawn offset never determines its drift direction. Size/life
  // are fixed (not randomized): a background dust speck's exact size/life
  // variance wasn't visually load-bearing, so this drops 2 draws entirely
  // instead of coupling them to an unrelated field.
  const TRAIL_SIZE = 4;
  const TRAIL_LIFE = 21;
  const spawnArmTrail = (sx: number, sy: number, color: number): void => {
    const rx = nextRandom();
    const ry = nextRandom();
    const rvx = nextRandom();
    const rvy = nextRandom();
    ctx.spawn({
      x: sx + (rx - 0.5) * 3,
      y: sy + (ry - 0.5) * 3,
      vx: (rvx - 0.5) * 0.3,
      vy: 0.1 + rvy * 0.2,
      color,
      size: TRAIL_SIZE,
      life: TRAIL_LIFE * ctx.settings.lifespanScale,
      gravity: 0.03 * ctx.settings.gravityScale,
      drag: 0.97,
    });
  };

  const spawnSplit = (sx: number, sy: number, svx: number, svy: number, color: number): void => {
    const magSq = svx * svx + svy * svy;
    const mag = Math.sqrt(magSq);
    const invMag = mag > 1e-6 ? 1 / mag : 0;
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
    const jitterIndex = Math.round((nextRandom() - 0.5) * 2 * ARM_JITTER_HALF_RANGE);
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
