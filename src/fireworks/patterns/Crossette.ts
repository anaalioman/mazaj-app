import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

/**
 * Palm Tree Crossette: 5-7 thick arms fired from center like fronds; each
 * arm trails its own dust (`onSparkle`) and, right at the end of its life,
 * splits into two sparks fired opposite each other, perpendicular to the
 * arm (`onSplit`) instead of continuing straight. Arm directions are real
 * polar coordinates (`angle = i/armCount * 2π`); the split direction is
 * derived from the arm's own velocity angle via `Math.atan2` at the moment
 * it splits, rotated ±90°.
 */
export function burstPalmCrossette(x: number, y: number, ctx: BurstContext): void {
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 3) : pickBurstColors(3);
  const armCount = 5 + Math.floor(Math.random() * 3); // 5, 6, or 7
  const baseSpeed = (3.0 + Math.random() * 1.4) * ctx.settings.explosionScale;

  const spawnArmTrail = (sx: number, sy: number, color: number): void => {
    ctx.spawn({
      x: sx + (Math.random() - 0.5) * 3,
      y: sy + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 0.3,
      vy: 0.1 + Math.random() * 0.2,
      color,
      size: 3 + Math.random() * 2,
      life: (16 + Math.random() * 10) * ctx.settings.lifespanScale,
      gravity: 0.03 * ctx.settings.gravityScale,
      drag: 0.97,
    });
  };

  const spawnSplit = (sx: number, sy: number, svx: number, svy: number, color: number): void => {
    const baseAngle = Math.atan2(svy, svx);
    const speed = Math.max(Math.hypot(svx, svy) * 0.7, 1.6);

    // Two sparks perpendicular to the arm's own direction — 180° apart from
    // each other, i.e. genuinely opposite directions.
    for (const sign of [1, -1]) {
      const angle = baseAngle + (Math.PI / 2) * sign;
      ctx.spawn({
        x: sx,
        y: sy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: (6 + Math.random() * 3) * ctx.glowSizeBoost,
        life: (26 + Math.random() * 16) * ctx.settings.lifespanScale,
        gravity: 0.12 * ctx.settings.gravityScale,
        drag: 0.98,
        twinkle: true,
      });
    }
  };

  for (let i = 0; i < armCount; i++) {
    const angle = (Math.PI * 2 * i) / armCount + (Math.random() - 0.5) * 0.15;
    const speed = baseSpeed * (0.85 + Math.random() * 0.3);
    const color = burstColors[Math.floor(Math.random() * burstColors.length)];
    const life = (55 + Math.random() * 20) * ctx.settings.lifespanScale;

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: (15 + Math.random() * 6) * ctx.glowSizeBoost, // thick frond
      life,
      gravity: 0.09 * ctx.settings.gravityScale,
      drag: 0.99,
      sparkleInterval: 2 + Math.random() * 2,
      onSparkle: (sx, sy) => spawnArmTrail(sx, sy, color),
      splitAt: life * 0.94, // right at the tip of the arm's life
      onSplit: (sx, sy, svx, svy) => spawnSplit(sx, sy, svx, svy, color),
    });
  }
}
