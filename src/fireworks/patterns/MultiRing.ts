import { fastSinByIndex, fastCosByIndex, TABLE_SIZE } from '../SineTable';
import { shadesOf, pickBurstColors } from '../colors';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

const RANDOM_TABLE_SIZE = 1024;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
// Prime, so coprime with the power-of-2 table size — an advancing cursor
// stepping by this stride visits RANDOM_TABLE_SIZE distinct slots before
// repeating any. This burst's max total draws (baseSpeed + 3 per particle x
// 2 rings x MAX_PER_RING = 901) stays under that, so no two draws in the
// same burst ever read the same slot.
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// Static pre-allocated object pool (safe but not solving a real race — see
// module doc comment below), capped at 300 total (150 per ring) — enough
// headroom for the real max of 125/ring at the highest density-slider
// setting (80 * (500/320) = 125), unlike the previous 100/ring cap which
// silently truncated ~20% of particles at max density.
const MAX_RING_PARTICLES = 300;
const MAX_PER_RING = MAX_RING_PARTICLES / 2;
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
 * objects allocated once at module load (300 total: 150 per ring) instead
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
