import { shadesOf } from '../colors';
import type { BurstContext } from './types';

const GOLD_HUES = [0xffd700, 0xffe9a8, 0xffc233, 0xfff4c2];

/**
 * Kamuro / Brocade Crown: a huge, dense shower of light, low-drag golden
 * stars that barely feel gravity and keep emitting glitter continuously
 * (via `sparkleInterval`/`onSparkle`, each callback spawning through the
 * same shared `ctx.spawn`), so they hang and drift down together like an
 * umbrella of falling gold. Real polar distribution, same technique as
 * Peony/Rose: `angle = i/count * 2π` -> `(cos, sin) * speed`.
 */
export function burstKamuro(x: number, y: number, ctx: BurstContext): void {
  const count = Math.max(20, Math.round((85 + Math.random() * 35) * ctx.densityRatio));
  const baseSpeed = (1.8 + Math.random() * 1.0) * ctx.settings.explosionScale;
  const hues = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : GOLD_HUES;

  const spawnSparkle = (sx: number, sy: number): void => {
    const color = hues[Math.floor(Math.random() * hues.length)];
    ctx.spawn({
      x: sx + (Math.random() - 0.5) * 4,
      y: sy + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: 0.12 + Math.random() * 0.2,
      color,
      size: (2 + Math.random() * 2) * ctx.glowSizeBoost,
      life: (26 + Math.random() * 22) * ctx.settings.lifespanScale,
      gravity: 0.035 * ctx.settings.gravityScale,
      drag: 0.975,
      twinkle: true,
    });
  };

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
    const speed = baseSpeed * (0.7 + Math.random() * 0.5);
    const color = hues[Math.floor(Math.random() * hues.length)];

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: (9 + Math.random() * 5) * ctx.glowSizeBoost,
      life: (210 + Math.random() * 90) * ctx.settings.lifespanScale,
      gravity: 0.045 * ctx.settings.gravityScale, // light weight: barely falls
      drag: 0.994, // low air resistance: keeps drifting outward
      sparkleInterval: 3 + Math.random() * 2, // frequent glitter -> continuous trail
      onSparkle: spawnSparkle,
    });
  }
}
