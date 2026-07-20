import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

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
 * arm (`onSplit`) instead of continuing straight. Arm directions are real
 * polar coordinates (`angle = i/armCount * 2π`); the split direction is
 * derived from the arm's own velocity vector via exact perpendicular-vector
 * algebra — rotating (svx, svy) by ±90° is just (∓svy, ±svx) — instead of
 * `Math.atan2` + `Math.cos`/`Math.sin` (verified numerically identical to
 * the old atan2-based version to within floating-point noise, 3.1e-15).
 * `Math.hypot` stays: it measures the arm's own speed to scale the split's
 * speed (70% of it), which isn't a trig call to begin with.
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

  const spawnArmTrail = (sx: number, sy: number, color: number): void => {
    ctx.spawn({
      x: sx + (nextRandom() - 0.5) * 3,
      y: sy + (nextRandom() - 0.5) * 3,
      vx: (nextRandom() - 0.5) * 0.3,
      vy: 0.1 + nextRandom() * 0.2,
      color,
      size: 3 + nextRandom() * 2,
      life: (16 + nextRandom() * 10) * ctx.settings.lifespanScale,
      gravity: 0.03 * ctx.settings.gravityScale,
      drag: 0.97,
    });
  };

  const spawnSplit = (sx: number, sy: number, svx: number, svy: number, color: number): void => {
    const mag = Math.hypot(svx, svy);
    const speed = Math.max(mag * 0.7, 1.6);
    const invMag = mag > 1e-6 ? 1 / mag : 0;

    // Two sparks perpendicular to the arm's own direction — 180° apart from
    // each other, i.e. genuinely opposite directions. Rotating (svx, svy) by
    // +90°/-90° is exactly (-svy, svx) / (svy, -svx) — no angle, no trig.
    for (const perp of [
      [-svy * invMag, svx * invMag],
      [svy * invMag, -svx * invMag],
    ]) {
      ctx.spawn({
        x: sx,
        y: sy,
        vx: perp[0] * speed,
        vy: perp[1] * speed,
        color,
        size: (6 + nextRandom() * 3) * ctx.glowSizeBoost,
        life: (26 + nextRandom() * 16) * ctx.settings.lifespanScale,
        gravity: 0.12 * ctx.settings.gravityScale,
        drag: 0.98,
        twinkle: true,
      });
    }
  };

  for (let i = 0; i < armCount; i++) {
    const angle = (Math.PI * 2 * i) / armCount + (nextRandom() - 0.5) * 0.15;
    const speed = baseSpeed * (0.85 + nextRandom() * 0.3);
    const color = burstColors[Math.floor(nextRandom() * burstColors.length)];
    const life = (55 + nextRandom() * 20) * ctx.settings.lifespanScale;

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
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
