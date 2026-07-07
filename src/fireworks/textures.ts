import { Application, Graphics, Texture } from 'pixi.js';

let cached: Texture | null = null;

// A single soft white circle, reused (via tint) for every particle/spark.
// Sharing one texture keeps the sprite batches cheap even with hundreds
// of particles on screen at once.
export function getParticleTexture(app: Application): Texture {
  if (cached) return cached;

  const radius = 32;
  const graphics = new Graphics();
  const steps = 6;
  for (let i = steps; i > 0; i--) {
    const t = i / steps;
    graphics.circle(radius, radius, radius * t);
    graphics.fill({ color: 0xffffff, alpha: 1 - t * 0.8 });
  }

  cached = app.renderer.generateTexture({
    target: graphics,
    resolution: 2,
  });
  graphics.destroy();
  return cached;
}
