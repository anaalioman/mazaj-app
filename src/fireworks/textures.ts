import { Application, FillGradient, Graphics, Texture } from 'pixi.js';

let cached: Texture | null = null;

// A single soft white circle, reused (via tint) for every particle/spark.
// Sharing one texture keeps the sprite batches cheap even with hundreds
// of particles on screen at once. Baked exactly once (memoized in `cached`)
// via a single circle filled with a genuine radial gradient — one fill
// call, not several concentric circles stacked to fake a soft edge — so the
// falloff is a true smooth gradient (no visible banding rings) and the
// one-time bake itself does less work.
export function getParticleTexture(app: Application): Texture {
  if (cached) return cached;

  const radius = 32;
  const gradient = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: 'rgba(255,255,255,1)' },
      { offset: 1, color: 'rgba(255,255,255,0)' },
    ],
  });
  const graphics = new Graphics().circle(radius, radius, radius).fill(gradient);

  cached = app.renderer.generateTexture({
    target: graphics,
    resolution: 2,
  });
  graphics.destroy();
  return cached;
}
