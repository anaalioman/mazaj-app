import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE, TWO_PI } from '../SineTable';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;
// Matches the old one-directional `+ rand * 0.4` radian jitter's visual
// spread, converted to index-space (0.4 / TWO_PI * TABLE_SIZE).
const ANGLE_JITTER_RANGE = Math.round((0.4 / TWO_PI) * TABLE_SIZE);

// countRaw's raw ceiling ((110 + rand*60) * densityRatio) reaches ~412 at
// densityRatio's true worst case — not just the density slider's own max
// (500/320 = 1.5625), but FireworksSystem's burstRandomHybrid() compounding
// that with up to a further ~1.55x, to ~2.42. The previous version had no
// cap at all: count grew unbounded with density, and every particle
// allocated a fresh object literal (no HARDWARE_POOL) — the exact class of
// issue already fixed in every sibling pattern file. STROBE_CAP sits safely
// above the real ~412 ceiling.
const STROBE_CAP = 450;

// Static pre-computed randomness pool, built once at module load — same
// convention as every sibling pattern file. Sized 2048: a max-density
// burst's total draws (3 pre-loop + up to 6 for the color pick + 412
// particles x 4 draws each ≈ 1657) stays comfortably under that — the
// previous 1024-slot table (stride 7) already wrapped and repeated well
// before covering this pattern's own real worst case. Stride is now 131
// (prime, coprime with any power-of-two table size), matching every sibling
// pattern file's own stride.
const RANDOM_TABLE_SIZE = 2048;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

const HARDWARE_POOL: ParticleOptions[] = new Array(STROBE_CAP);
for (let i = 0; i < STROBE_CAP; i++) {
  HARDWARE_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, strobe: true };
}

/**
 * Strobe / Glitter Shell: stars that randomly blink fully on/off (not a
 * smooth twinkle) at varying speeds as they fall, like sparkling diamond
 * fragments, before finally extinguishing. Same polar distribution as
 * Peony/Kamuro; `strobe: true` drives the on/off blink in `Particle.update()`
 * — a deltaTime-driven bitwise index toggle there (see its own doc
 * comment), not something this one-shot spawn function has any part of.
 *
 * Every random draw (color-count variance/burst-color pick, count/speed
 * jitter, per-particle angle jitter/color/size/life) walks `randomTable` via
 * a single advancing cursor (`nextRandom`), zero live `Math.random()` calls.
 * Direction comes from `fastCosByIndex`/`fastSinByIndex` in `SineTable`'s
 * integer index space, zero live `Math.cos`/`Math.sin`. Every spark spawns
 * through a mutated `HARDWARE_POOL` slot instead of a fresh object literal.
 */
export function burstStrobe(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;
  const nextRandom = (): number => {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[rIdx];
  };

  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 5) : pickBurstColors(4 + ((nextRandom() * 2) | 0), nextRandom);
  const colorLen = burstColors.length;

  const countRaw = (110 + nextRandom() * 60) * ctx.densityRatio;
  const countFloor = ((countRaw + 0.5) | 0) > 10 ? (countRaw + 0.5) | 0 : 10;
  const count = Math.min(STROBE_CAP, countFloor);
  const baseSpeed = (2.6 + nextRandom() * 2.0) * ctx.settings.explosionScale;
  const angleStep = TABLE_SIZE / count;
  const gravityVal = 0.11 * ctx.settings.gravityScale;
  const lifespanScaleVal = ctx.settings.lifespanScale;
  const glowSizeBoostVal = ctx.glowSizeBoost;

  for (let i = 0; i < count; i++) {
    const jitterIndex = (nextRandom() * ANGLE_JITTER_RANGE) | 0;
    const angleIndex = (((i * angleStep) | 0) + jitterIndex) & TABLE_MASK;
    const speed = ctx.fillSpeed(baseSpeed);
    const color = burstColors[(nextRandom() * colorLen) | 0];
    const size = (6 + nextRandom() * 4) * glowSizeBoostVal;
    const life = (90 + nextRandom() * 70) * lifespanScaleVal;

    const pObj = HARDWARE_POOL[i];
    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCosByIndex(angleIndex) * speed;
    pObj.vy = fastSinByIndex(angleIndex) * speed;
    pObj.color = color;
    pObj.size = size;
    pObj.life = life;
    pObj.gravity = gravityVal;
    pObj.drag = 0.988;

    ctx.spawn(pObj);
  }
}
