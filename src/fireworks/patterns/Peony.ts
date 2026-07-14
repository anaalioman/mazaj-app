import { lerpColor } from '../Particle';
import { contrastingPalette, randomColor, randomPalette } from '../colors';
import type { BurstContext } from './types';

/**
 * Peony with Pistil Core: a dense outer sphere in one primary color, and a
 * smaller, slower inner sphere in a contrasting color exploding at the
 * same instant — the classic two-tone "flower with a center" look.
 *
 * Real polar-coordinate distribution: every spark's direction is
 * `angle = i/count * 2π` (a point on the unit circle), converted to a
 * Cartesian velocity via `(cos(angle), sin(angle)) * speed` — genuine
 * `Math.cos`/`Math.sin` polar-to-Cartesian conversion, not a fixed image or
 * CSS shape. `fillSpeed()` samples speed uniformly across the full radius
 * range (not just the rim) so the sphere fills with real depth.
 */
export function burstPeony(x: number, y: number, ctx: BurstContext): void {
  const outerPalette = randomPalette();
  const primaryColor = ctx.activeColor ?? randomColor(outerPalette);
  const pistilColor = ctx.activeColor !== null ? lerpColor(ctx.activeColor, 0xffffff, 0.5) : randomColor(contrastingPalette(outerPalette));

  // Base counts tuned so a default-density burst lands around 250-400
  // total sparks between the outer sphere and pistil core combined.
  const outerCount = Math.max(8, Math.round((180 + Math.random() * 80) * ctx.densityRatio));
  const outerSpeed = (2.6 + Math.random() * 2.0) * ctx.settings.explosionScale;

  for (let i = 0; i < outerCount; i++) {
    const angle = (Math.PI * 2 * i) / outerCount + Math.random() * 0.25;
    const speed = ctx.fillSpeed(outerSpeed);

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: primaryColor,
      size: (7 + Math.random() * 4) * ctx.glowSizeBoost,
      life: (55 + Math.random() * 40) * ctx.settings.lifespanScale,
      gravity: 0.1 * ctx.settings.gravityScale,
      drag: 0.982,
      twinkle: Math.random() < 0.25,
    });
  }

  const pistilCount = Math.max(6, Math.round(outerCount * 0.45));
  const pistilSpeed = outerSpeed * 0.42;

  for (let i = 0; i < pistilCount; i++) {
    const angle = (Math.PI * 2 * i) / pistilCount + Math.random() * 0.4;
    const speed = ctx.fillSpeed(pistilSpeed);

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: pistilColor,
      size: (5 + Math.random() * 3) * ctx.glowSizeBoost,
      life: (38 + Math.random() * 22) * ctx.settings.lifespanScale,
      gravity: 0.1 * ctx.settings.gravityScale,
      drag: 0.978,
      twinkle: Math.random() < 0.3,
    });
  }
}
