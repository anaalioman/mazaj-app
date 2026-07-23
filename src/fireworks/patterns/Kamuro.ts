import { fastSinByIndex, fastCosByIndex, TABLE_SIZE } from '../SineTable';
import { shadesOf } from '../colors';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;

// Static pre-baked noise table, built once at module load — same convention
// as Heart.ts/MultiRing.ts/Peony.ts/Rose.ts. Sized 2048: countRaw's own
// ceiling (see KAMURO_CAP's doc comment) reaches ~291 at densityRatio's true
// worst case, so a max-density burst draws up to 2 + 291*5 = 1457 times,
// comfortably under 2048. Stride 131 (prime, coprime with any power-of-two
// table size) matches every sibling pattern file's own stride.
const RANDOM_TABLE_SIZE = 2048;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// countRaw's raw ceiling ((85 + rand*35) * densityRatio) reaches ~291 at
// densityRatio's true worst case (not just the density slider's own max of
// 500/320 = 1.5625, but FireworksSystem's burstRandomHybrid() compounding
// that with up to a further ~1.55x, to ~2.42). KAMURO_CAP sits safely above
// that so no real burst is ever silently truncated.
const KAMURO_CAP = 350;
const HARDWARE_POOL: ParticleOptions[] = new Array(KAMURO_CAP);
for (let i = 0; i < KAMURO_CAP; i++) {
  HARDWARE_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };
}

// One shared, reused slot for every sparkle emission across every Kamuro
// star, system-wide — sparkles fire one at a time (each star's own
// `sparkleInterval` ticks on FireworksSystem's single-threaded update loop,
// never concurrently), and `Particle.init()` copies every field
// synchronously the instant `ctx.spawn()` is called, so a single mutated
// slot is safe instead of a fresh object literal per sparkle.
const SPARKLE_SLOT: ParticleOptions = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: true };

const GOLD_HUES = [0xffd700, 0xffe9a8, 0xffc233, 0xfff4c2];

/**
 * Kamuro / Brocade Crown: a huge, dense shower of light, low-drag golden
 * stars that barely feel gravity and keep emitting glitter continuously
 * (via `sparkleInterval`/`onSparkle`, each callback spawning through the
 * same shared `ctx.spawn`), so they hang and drift down together like an
 * umbrella of falling gold.
 *
 * Distribution comes from `fastCosByIndex`/`fastSinByIndex`. Every random
 * draw — count/speed jitter, per-particle angle jitter/speed/size/life/
 * sparkleInterval, and every later sparkle emission's own offset/velocity/
 * size/life/color — walks `randomTable` via a single advancing cursor,
 * zero live `Math.random()` calls. Every burst particle spawns through a
 * mutated `HARDWARE_POOL` slot; every sparkle spawns through the single
 * shared `SPARKLE_SLOT` — neither allocates a fresh object literal.
 */
export function burstKamuro(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const countRaw = Math.max(20, ((85 + (randomTable[rIdx] - 0.5) * 35) * ctx.densityRatio + 0.5) | 0);
  const count = Math.min(KAMURO_CAP, countRaw);

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const baseSpeed = (1.8 + (randomTable[rIdx] - 0.5) * 1.0) * ctx.settings.explosionScale;
  const hues = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : GOLD_HUES;
  const gravityVal = 0.045 * ctx.settings.gravityScale;
  const lifespanScaleVal = ctx.settings.lifespanScale;
  const glowSizeBoostVal = ctx.glowSizeBoost;

  const spawnSparkle = (sx: number, sy: number): void => {
    let sIdx = ((sx | 0) ^ (sy | 0)) & RANDOM_MASK;
    const color = hues[sIdx & 3];

    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const offsetX = (randomTable[sIdx] - 0.5) * 4;
    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const offsetY = (randomTable[sIdx] - 0.5) * 4;
    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const svx = (randomTable[sIdx] - 0.5) * 0.3;
    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const svy = 0.12 + randomTable[sIdx] * 0.2;
    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const ssize = (2 + randomTable[sIdx] * 2) * glowSizeBoostVal;
    sIdx = (sIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const slife = (26 + randomTable[sIdx] * 22) * lifespanScaleVal;

    SPARKLE_SLOT.x = sx + offsetX;
    SPARKLE_SLOT.y = sy + offsetY;
    SPARKLE_SLOT.vx = svx;
    SPARKLE_SLOT.vy = svy;
    SPARKLE_SLOT.color = color;
    SPARKLE_SLOT.size = ssize;
    SPARKLE_SLOT.life = slife;
    SPARKLE_SLOT.gravity = 0.035 * ctx.settings.gravityScale;
    SPARKLE_SLOT.drag = 0.975;

    ctx.spawn(SPARKLE_SLOT);
  };

  const angleStep = TABLE_SIZE / count;

  for (let i = 0; i < count; i++) {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const angleIndex = Math.round(i * angleStep + (randomTable[rIdx] - 0.5) * 15) & TABLE_MASK;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const speed = baseSpeed * (0.7 + randomTable[rIdx] * 0.5);
    const color = hues[i & 3];

    const pObj = HARDWARE_POOL[i];
    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCosByIndex(angleIndex) * speed;
    pObj.vy = fastSinByIndex(angleIndex) * speed;
    pObj.color = color;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.size = (9 + randomTable[rIdx] * 5) * glowSizeBoostVal;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.life = (210 + randomTable[rIdx] * 90) * lifespanScaleVal;
    pObj.gravity = gravityVal;
    pObj.drag = 0.994;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    pObj.sparkleInterval = 3 + randomTable[rIdx] * 2;
    pObj.onSparkle = spawnSparkle;

    ctx.spawn(pObj);
  }
}
