import { lerpColor } from '../Particle';
import { contrastingPalette, randomColor, randomPalette } from '../colors';
import type { BurstContext } from './types';

/**
 * Multi-Ring: two flat ellipses expanding from the same center at the
 * same instant — one squashed vertically ("horizontal" ring), one
 * squashed horizontally ("vertical" ring) — crossing each other to read
 * as two intersecting rings. Real parametric ellipse equations
 * (`x = cos(theta) * speed`, `y = sin(theta) * speed * squash`), evaluated
 * per particle — not a static image or CSS shape.
 */
export function burstMultiRing(x: number, y: number, ctx: BurstContext): void {
  const paletteA = randomPalette();
  const colorA = ctx.activeColor ?? randomColor(paletteA);
  const colorB = ctx.activeColor !== null ? lerpColor(ctx.activeColor, 0xffffff, 0.4) : randomColor(contrastingPalette(paletteA));

  const count = Math.max(30, Math.round(80 * ctx.densityRatio));
  const speed = (3.6 + Math.random() * 1.2) * ctx.settings.explosionScale;

  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    ctx.spawn({
      x,
      y,
      vx: Math.cos(theta) * speed,
      vy: Math.sin(theta) * speed * 0.32,
      color: colorA,
      size: (7 + Math.random() * 4) * ctx.glowSizeBoost,
      life: (65 + Math.random() * 30) * ctx.settings.lifespanScale,
      gravity: 0.06 * ctx.settings.gravityScale,
      drag: 0.99,
      twinkle: Math.random() < 0.2,
    });
  }

  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    ctx.spawn({
      x,
      y,
      vx: Math.cos(theta) * speed * 0.32,
      vy: Math.sin(theta) * speed,
      color: colorB,
      size: (7 + Math.random() * 4) * ctx.glowSizeBoost,
      life: (65 + Math.random() * 30) * ctx.settings.lifespanScale,
      gravity: 0.06 * ctx.settings.gravityScale,
      drag: 0.99,
      twinkle: Math.random() < 0.2,
    });
  }
}
