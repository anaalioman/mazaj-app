import { fastSinByIndex, fastCosByIndex, TABLE_SIZE } from '../SineTable';
import { shadesOf, pickBurstColors } from '../colors';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

// countRaw's raw ceiling (80 * densityRatio) isn't bounded by just the
// density slider's own max (500/320 = 1.5625) — FireworksSystem's
// burstRandomHybrid() can also multiply particleDensity by up to a further
// ~1.55x for a one-off hybrid burst before calling this same function,
// compounding to a true ceiling of ~2.42, i.e. countRaw up to ~194. The
// previous MAX_PER_RING=150 (sized only against the slider-only ceiling of
// 125) silently truncated ~23% of particles at that real worst case —
// the exact class of bug this file's own history already fixed once for
// the density slider alone, missed for the hybrid-randomizer multiplier.
// MAX_PER_RING=220 sits safely above the corrected ~194 ceiling.
const MAX_RING_PARTICLES = 440;
const MAX_PER_RING = MAX_RING_PARTICLES / 2;

// This burst's max total draws (baseSpeed + 3 per particle x 2 rings x
// MAX_PER_RING = 1 + 3*2*220 = 1321) needs a table sized above that — 1024
// (sufficient for the old, undercounted ceiling) would wrap and repeat
// slots mid-burst at the real worst case, so this is now 2048. Stride
// stays prime (131, coprime with any power-of-two table size), so the walk
// still visits every slot once before repeating.
const RANDOM_TABLE_SIZE = 2048;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();
const HARDWARE_POOL: ParticleOptions[] = new Array(MAX_RING_PARTICLES);
for (let i = 0; i < MAX_RING_PARTICLES; i++) {
  HARDWARE_POOL[i] = {
    x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false,
  };
}

/**
 * Multi-Ring: two flat ellipses expanding from the same center at the
 * same instant — one squashed vertically ("horizontal" ring), one
 * squashed horizontally ("vertical" ring) — crossing each other to read
 * as two intersecting rings. Distribution comes from `fastCosByIndex`/
 * `fastSinByIndex` instead of live `Math.cos`/`Math.sin`; every per-particle
 * random draw (across both rings) walks `randomTable` via a single
 * advancing cursor (`rIdx`), never live `Math.random()`.
 *
 * Each spawn call reads from `HARDWARE_POOL`, a fixed set of `ParticleOptions`
 * objects allocated once at module load (440 total: 220 per ring) instead
 * of a single reused object or per-particle literals. `Particle.init()`
 * (see its own doc comment) copies every field synchronously the instant
 * `ctx.spawn()` is called and never retains a reference to the options
 * object afterward, so a single reused object was already safe — this
 * pool doesn't fix an existing bug, it's an alternate (also safe) way to
 * avoid a fresh object literal per particle.
 */
export function burstMultiRing(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;

  const hues = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(4);

  const countRaw = Math.max(30, 80 * ctx.densityRatio);
  const countMax = (countRaw + 0.5) | 0;
  const count = Math.min(MAX_PER_RING, countMax); // capped to fit HARDWARE_POOL (MAX_PER_RING per ring)

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const baseSpeed = (3.6 + randomTable[rIdx] * 1.2) * ctx.settings.explosionScale;
  const indexFactor = TABLE_SIZE / count;

  const gravityVal = 0.06 * ctx.settings.gravityScale;
  const lifespanScaleVal = ctx.settings.lifespanScale;

  for (let i = 0; i < count; i++) {
    const angleIdx = (i * indexFactor) | 0;
    const pObj = HARDWARE_POOL[i];

    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCosByIndex(angleIdx) * baseSpeed;
    pObj.vy = fastSinByIndex(angleIdx) * baseSpeed * 0.32;
    pObj.color = hues[i & 3];

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (7 + randomTable[rIdx] * 4) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (65 + randomTable[rIdx] * 30) * lifespanScaleVal;
    pObj.gravity = gravityVal;
    pObj.drag = 0.99;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.twinkle = randomTable[rIdx] < 0.2;

    ctx.spawn(pObj);
  }

  for (let i = 0; i < count; i++) {
    const angleIdx = (i * indexFactor) | 0;
    const pObj = HARDWARE_POOL[i + count]; // contiguous offset — ranges [0,count) and [count,2*count) never overlap since count <= MAX_PER_RING

    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCosByIndex(angleIdx) * baseSpeed * 0.32;
    pObj.vy = fastSinByIndex(angleIdx) * baseSpeed;
    pObj.color = hues[(i + 1) & 3];

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (7 + randomTable[rIdx] * 4) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (65 + randomTable[rIdx] * 30) * lifespanScaleVal;
    pObj.gravity = gravityVal;
    pObj.drag = 0.99;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.twinkle = randomTable[rIdx] < 0.2;

    ctx.spawn(pObj);
  }
}
