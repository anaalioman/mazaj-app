import { Application, FillGradient, Graphics, Texture } from 'pixi.js';
import { createOffscreenCanvas } from '../dom/shadowServices';

let cached: Texture | null = null;
let cachedGlow: Texture | null = null;

// Same overall texture size as the previous radial-gradient version
// (radius 32 * diameter 2 * resolution 2 = 128px) — no VRAM increase, just
// a different bake technique for the same footprint.
const TEXTURE_SIZE = 128;

// --- Dependency-free 2D Perlin noise -----------------------------------
// A small pseudo-random permutation table, shuffled once at module load,
// classic Perlin gradient noise, and a fractal (multi-octave) sum on top
// of it — no external noise library, no image asset. Used purely to
// roughen the particle texture's edge/interior into a grainy, gunpowder-
// spark look instead of a perfectly smooth radial gradient.
// Fixed seed (not Math.random()): the permutation table drives the exact
// noise pattern baked into the shared particle texture, so every launch of
// the app must shuffle it identically — otherwise the spark's grain/edge
// would look subtly different session to session instead of being a fixed,
// deliberately-tuned visual identity.
const PERMUTATION_SEED = 0x5eed1234;

/** Deterministic PRNG (mulberry32) — same output sequence for the same seed on every run, unlike Math.random(). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM_SIZE = 256;
const perm = new Uint8Array(PERM_SIZE * 2);
(function seedPermutation(): void {
  const random = mulberry32(PERMUTATION_SEED);
  const p = new Uint8Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) p[i] = i;
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < PERM_SIZE * 2; i++) perm[i] = p[i & (PERM_SIZE - 1)];
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Single-octave 2D Perlin noise, range roughly [-1, 1]. */
function perlin2(x: number, y: number): number {
  const xi = Math.floor(x) & (PERM_SIZE - 1);
  const yi = Math.floor(y) & (PERM_SIZE - 1);
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];

  const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

/** Multi-octave (fractal) noise: several perlin2 calls at doubling frequency and halving amplitude, summed and renormalized — the standard technique for organic-looking grain instead of one smooth wave. */
function fractalNoise(x: number, y: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let o = 0; o < octaves; o++) {
    total += perlin2(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / maxValue;
}

// A single procedurally-noised white spark, reused (via tint) for every
// particle/spark in the game. Baked exactly once (memoized in `cached`) by
// writing raw pixel data into an offscreen <canvas> — a genuine per-pixel
// bake, not a live per-frame draw — then wrapping that canvas as a Pixi
// Texture. Sharing one texture keeps every particle's own draw batched
// cheaply regardless of how many are on screen at once.
export function getParticleTexture(): Texture {
  if (cached) return cached;

  const size = TEXTURE_SIZE;
  const center = size / 2;
  // Never attached to the visible DOM — the same "shadow service" offscreen
  // canvas convention already used for recording (see shadowServices.ts's
  // own doc comment), reused here purely as a per-pixel noise buffer.
  const canvas = createOffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot bake particle texture');

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const noiseScale = 0.15;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy) / center;

      // Smooth radial falloff (same soft-circle envelope as before)...
      const falloff = Math.max(0, 1 - dist);
      const smoothFalloff = falloff * falloff * (3 - 2 * falloff);

      // ...roughened by fractal noise so the edge/interior reads as grainy
      // gunpowder-spark texture instead of a flat, perfectly smooth bubble.
      const noise = fractalNoise(x * noiseScale, y * noiseScale, 3);
      const roughened = smoothFalloff + noise * 0.35 * smoothFalloff;
      const alpha = Math.max(0, Math.min(1, roughened));

      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  cached = Texture.from(canvas);
  return cached;
}

const GLOW_TEXTURE_SIZE = 256;

// A dedicated, perfectly smooth radial-gradient blob — deliberately NOT the
// grainy Perlin-noise spark texture above. Built via PixiJS's own
// FillGradient + Graphics + renderer.generateTexture() pipeline rather than
// a raw canvas bake, per explicit instruction. Baked once (memoized in
// `cachedGlow`) the first time GroundFountain needs it.
export function getGlowTexture(app: Application): Texture {
  if (cachedGlow) return cachedGlow;

  const radius = GLOW_TEXTURE_SIZE / 2;

  const gradient = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: 'rgba(255, 255, 255, 1)' },
      { offset: 0.35, color: 'rgba(255, 255, 255, 0.55)' },
      { offset: 1, color: 'rgba(255, 255, 255, 0)' },
    ],
  });

  const graphics = new Graphics().circle(radius, radius, radius).fill(gradient);

  cachedGlow = app.renderer.generateTexture({ target: graphics, resolution: 1 });
  graphics.destroy();

  return cachedGlow;
}
