import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

/**
 * Strobe / Glitter Shell: stars that randomly blink fully on/off (not a
 * smooth twinkle) at varying speeds as they fall, like sparkling diamond
 * fragments, before finally extinguishing. Same polar distribution as
 * Peony/Kamuro; `strobe: true` drives the on/off blink in `Particle.update()`.
 */
export function burstStrobe(x: number, y: number, ctx: BurstContext): void {
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 5) : pickBurstColors(4 + Math.floor(Math.random() * 2));
  const count = Math.max(10, Math.round((110 + Math.random() * 60) * ctx.densityRatio));
  const baseSpeed = (2.6 + Math.random() * 2.0) * ctx.settings.explosionScale;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = ctx.fillSpeed(baseSpeed);
    const color = burstColors[Math.floor(Math.random() * burstColors.length)];

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size: (6 + Math.random() * 4) * ctx.glowSizeBoost,
      life: (90 + Math.random() * 70) * ctx.settings.lifespanScale,
      gravity: 0.11 * ctx.settings.gravityScale,
      drag: 0.988,
      strobe: true,
    });
  }
}
