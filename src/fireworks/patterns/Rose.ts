import { pickBurstColors, shadesOf } from '../colors';
import { cosByIndex, sinByIndex, TABLE_SIZE } from '../SineTable';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;

/**
 * Polar rose burst: initial velocity follows `r = cos(k*theta)`, so as
 * particles fly outward in straight lines the expanding pattern traces a
 * k-petaled rose curve (negative r flips through the origin, which is
 * exactly how the classic rose curve handles it) — real polar-curve math,
 * evaluated once per particle in the ticker-driven spawn loop, entirely in
 * `SineTable`'s integer index space (`sinByIndex`/`cosByIndex`): theta and
 * k*theta are wrapped via `& TABLE_MASK` instead of a radian-based
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

  for (let i = 0; i < count; i++) {
    const thetaIndex = Math.round((i / count) * TABLE_SIZE) & TABLE_MASK;
    const petalIndex = (k * thetaIndex) & TABLE_MASK;
    // Exact r * baseSpeed, no per-particle variance — every spark lands
    // precisely on the mathematical rose curve instead of scattered ±10%
    // around it.
    const r = cosByIndex(petalIndex);
    const speed = r * baseSpeed;
    const cosT = cosByIndex(thetaIndex);
    const sinT = sinByIndex(thetaIndex);
    const color = burstColors[Math.floor(Math.random() * burstColors.length)];

    ctx.spawn({
      x,
      y,
      vx: cosT * speed,
      vy: sinT * speed,
      color,
      size: (7 + Math.random() * 5) * ctx.glowSizeBoost,
      life: (60 + Math.random() * 40) * ctx.settings.lifespanScale,
      gravity: 0.08 * ctx.settings.gravityScale,
      drag: 0.978,
      twinkle: Math.random() < 0.25,
    });
  }
}
