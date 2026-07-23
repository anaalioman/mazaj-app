import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE } from '../SineTable';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;

// Static pre-computed randomness pool, built once at module load — same
// convention as Heart.ts/MultiRing.ts/Peony.ts. Sized 2048: countRaw's own
// ceiling (140 * densityRatio) reaches ~339 at densityRatio's true worst
// case — not just the density slider's own max (500/320 = 1.5625), but
// FireworksSystem's burstRandomHybrid() compounding that with up to a
// further ~1.55x, to ~2.42 — so a max-density burst draws up to
// 3 + 339*4 = 1359 times, comfortably under 2048. Stride 131 (prime,
// coprime with any power-of-two table size) matches every sibling pattern
// file's own stride, so the walk still visits every slot once per burst
// before repeating.
const RANDOM_TABLE_SIZE = 2048;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// countRaw's raw ceiling (see the table's own doc comment above) reaches
// ~339 at densityRatio's true worst case. ROSE_CAP sits safely above that
// so no real burst is ever silently truncated.
const ROSE_CAP = 400;
const HARDWARE_POOL: ParticleOptions[] = new Array(ROSE_CAP);
for (let i = 0; i < ROSE_CAP; i++) {
  HARDWARE_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };
}

/**
 * Polar rose burst: initial velocity follows `r = cos(k*theta)`, so as
 * particles fly outward in straight lines the expanding pattern traces a
 * k-petaled rose curve (negative r flips through the origin, which is
 * exactly how the classic rose curve handles it) — real polar-curve math,
 * evaluated once per particle in the ticker-driven spawn loop, entirely in
 * `SineTable`'s integer index space (`fastSinByIndex`/`fastCosByIndex`):
 * theta and k*theta are wrapped via `& TABLE_MASK` instead of a radian-based
 * subtraction loop, so there's no branch and no live `Math.cos`/`sin`.
 *
 * Every random draw (color-count variance, petal count `k`, base speed
 * jitter, and per-particle color/size/life/twinkle) walks `randomTable` via
 * a single advancing cursor (`rIdx`) seeded from the explosion center,
 * zero live Math.random() calls. Every spark spawns through a mutated
 * `HARDWARE_POOL` slot instead of a fresh object literal per particle.
 */
export function burstRose(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;
  const nextRandom = (): number => {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[rIdx];
  };

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(3 + ((randomTable[rIdx] * 3) | 0), nextRandom);
  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const k = 2 + ((randomTable[rIdx] * 5) | 0);
  // Back to the same base count every other pattern uses proportionally
  // (was temporarily cut to 100 to manage spawn-loop CPU cost before
  // FireworksSystem.ts had a real object pool — see its `deadPool` doc
  // comment — which removed that pressure; no reason for Rose to be the
  // one thin-looking pattern now that the actual cost problem is fixed).
  const countRaw = Math.max(20, (140 * ctx.densityRatio + 0.5) | 0);
  const count = Math.min(ROSE_CAP, countRaw);
  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const baseSpeed = (3.4 + randomTable[rIdx] * 1.6) * ctx.settings.explosionScale;
  const colorsLength = burstColors.length;
  const gravityVal = 0.08 * ctx.settings.gravityScale;
  const lifespanScaleVal = ctx.settings.lifespanScale;

  for (let i = 0; i < count; i++) {
    const thetaIndex = ((i / count) * TABLE_SIZE) & TABLE_MASK;
    const petalIndex = (k * thetaIndex) & TABLE_MASK;
    // Exact r * baseSpeed, no per-particle variance — every spark lands
    // precisely on the mathematical rose curve instead of scattered ±10%
    // around it.
    const r = fastCosByIndex(petalIndex);
    const speed = r * baseSpeed;
    const cosT = fastCosByIndex(thetaIndex);
    const sinT = fastSinByIndex(thetaIndex);

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const color = burstColors[(randomTable[rIdx] * colorsLength) | 0];

    const pObj = HARDWARE_POOL[i];
    pObj.x = x;
    pObj.y = y;
    pObj.vx = cosT * speed;
    pObj.vy = sinT * speed;
    pObj.color = color;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (7 + randomTable[rIdx] * 5) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (60 + randomTable[rIdx] * 40) * lifespanScaleVal;
    pObj.gravity = gravityVal;
    pObj.drag = 0.978;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.twinkle = randomTable[rIdx] < 0.25;

    ctx.spawn(pObj);
  }
}
