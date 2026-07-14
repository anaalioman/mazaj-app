import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

/**
 * Polar rose burst: initial velocity follows `r = cos(k*theta)`, so as
 * particles fly outward in straight lines the expanding pattern traces a
 * k-petaled rose curve (negative r flips through the origin, which is
 * exactly how the classic rose curve handles it) — real polar-curve math,
 * evaluated once per particle in the ticker-driven spawn loop.
 */
export function burstRose(x: number, y: number, ctx: BurstContext): void {
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(3 + Math.floor(Math.random() * 3));
  const k = 2 + Math.floor(Math.random() * 5);
  // A thin curve reads clearly with far fewer points than a filled sphere
  // needs (Peony's base count is 180-260) — even at k=6 (the densest
  // petal count) and the lowest density setting, this still puts dozens of
  // points on every petal.
  const count = Math.max(20, Math.round(100 * ctx.densityRatio));
  const baseSpeed = (3.4 + Math.random() * 1.6) * ctx.settings.explosionScale;

  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const r = Math.cos(k * theta);
    const speed = r * baseSpeed * (0.9 + Math.random() * 0.2);
    const color = burstColors[Math.floor(Math.random() * burstColors.length)];

    ctx.spawn({
      x,
      y,
      vx: Math.cos(theta) * speed,
      vy: Math.sin(theta) * speed,
      color,
      size: (7 + Math.random() * 5) * ctx.glowSizeBoost,
      life: (60 + Math.random() * 40) * ctx.settings.lifespanScale,
      gravity: 0.08 * ctx.settings.gravityScale,
      drag: 0.978,
      twinkle: Math.random() < 0.25,
    });
  }
}
