import { lerpColor } from '../Particle';
import { contrastingPalette, randomColor, randomPalette } from '../colors';
import { fastCos, fastSin } from '../SineTable';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

// Static noise pool baked once at module load (the only place Math.random()
// runs), walked via an advancing index — same convention as Heart.ts/
// Strobe.ts/MultiRing.ts. Sized 4096: this pattern's own worst-case draw
// count (see OUTER_CAP's doc comment below) reaches ~2744 in a single
// burst, so 2048 (the size used by lighter patterns) would wrap and repeat
// slots mid-burst. Stride stays prime (131, coprime with any power-of-two
// table size), so the walk still visits every slot once before repeating.
const RANDOM_TABLE_SIZE = 4096;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// outerCount's raw formula is round((180 + rand*80) * densityRatio).
// densityRatio's true ceiling isn't just the density slider's own max
// (500/320 = 1.5625) — FireworksSystem's burstRandomHybrid() can also
// multiply particleDensity by up to ~1.55x for a one-off hybrid burst
// before calling this same function, compounding to ~2.42. At that
// ceiling, outerCount's raw value reaches ~630 — OUTER_CAP sits safely
// above it so no real burst is ever silently truncated. pistilCount is
// always 0.45x the (already-capped) outerCount, so PISTIL_CAP only needs
// margin over 0.45 * OUTER_CAP.
const OUTER_CAP = 700;
const PISTIL_CAP = 320;
const POOL_SIZE = OUTER_CAP + PISTIL_CAP;
const HARDWARE_POOL: ParticleOptions[] = new Array(POOL_SIZE);
for (let i = 0; i < POOL_SIZE; i++) {
  HARDWARE_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };
}

/**
 * Peony with Pistil Core: a dense outer sphere in one primary color, and a
 * smaller, slower inner sphere in a contrasting color exploding at the
 * same instant — the classic two-tone "flower with a center" look.
 *
 * Real polar-coordinate distribution: every spark's direction is
 * `angle = i/count * 2π` (a point on the unit circle), converted to a
 * Cartesian velocity via `(cos(angle), sin(angle)) * speed` — via
 * `fastCos`/`fastSin` (the shared precomputed `SineTable` lookup), since
 * `angle` here is already in `[0, TWO_PI)` and needs no extra wrapping.
 * `fillSpeed()` samples speed uniformly across the full radius range (not
 * just the rim) so the sphere fills with real depth.
 *
 * Every random draw (count/speed jitter/size/life/twinkle, across both
 * spheres) walks `randomTable` via a single advancing cursor (`rIdx`),
 * zero live Math.random() calls. Every spark spawns through a mutated
 * `HARDWARE_POOL` slot (fixed partition: outer sphere at indices
 * `[0, OUTER_CAP)`, pistil core at `[OUTER_CAP, POOL_SIZE)`) instead of a
 * fresh object literal per particle.
 */
export function burstPeony(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;

  const outerPalette = randomPalette();
  const primaryColor = ctx.activeColor ?? randomColor(outerPalette);
  // 0.25 (not 0.5): a lighter, hotter-reading tint of the dyed color without
  // washing it out toward white — keeps the pistil visibly saturated.
  const pistilColor = ctx.activeColor !== null ? lerpColor(ctx.activeColor, 0xffffff, 0.25) : randomColor(contrastingPalette(outerPalette));

  // Base counts tuned so a default-density burst lands around 250-400
  // total sparks between the outer sphere and pistil core combined.
  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const outerCountRaw = Math.max(8, ((180 + randomTable[rIdx] * 80) * ctx.densityRatio + 0.5) | 0);
  const outerCount = Math.min(OUTER_CAP, outerCountRaw);

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const outerSpeed = (2.6 + randomTable[rIdx] * 2.0) * ctx.settings.explosionScale;
  const gravityVal = 0.1 * ctx.settings.gravityScale;

  for (let i = 0; i < outerCount; i++) {
    // Exact even spacing, no per-particle jitter — a clean geometric circle.
    const angle = (Math.PI * 2 * i) / outerCount;
    const speed = ctx.fillSpeed(outerSpeed);
    const pObj = HARDWARE_POOL[i];

    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCos(angle) * speed;
    pObj.vy = fastSin(angle) * speed;
    pObj.color = primaryColor;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (7 + randomTable[rIdx] * 4) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (55 + randomTable[rIdx] * 40) * ctx.settings.lifespanScale;
    pObj.gravity = gravityVal;
    pObj.drag = 0.982;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.twinkle = randomTable[rIdx] < 0.25;

    ctx.spawn(pObj);
  }

  const pistilCount = Math.min(PISTIL_CAP, Math.max(6, (outerCount * 0.45 + 0.5) | 0));
  const pistilSpeed = outerSpeed * 0.42;

  for (let i = 0; i < pistilCount; i++) {
    const angle = (Math.PI * 2 * i) / pistilCount;
    const speed = ctx.fillSpeed(pistilSpeed);
    const pObj = HARDWARE_POOL[OUTER_CAP + i];

    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCos(angle) * speed;
    pObj.vy = fastSin(angle) * speed;
    pObj.color = pistilColor;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (5 + randomTable[rIdx] * 3) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (38 + randomTable[rIdx] * 22) * ctx.settings.lifespanScale;
    pObj.gravity = gravityVal;
    pObj.drag = 0.978;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.twinkle = randomTable[rIdx] < 0.3;

    ctx.spawn(pObj);
  }
}
