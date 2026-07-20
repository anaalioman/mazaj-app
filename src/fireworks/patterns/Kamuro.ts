import { fastSinByIndex, fastCosByIndex, TABLE_SIZE } from '../SineTable';
import { shadesOf } from '../colors';
import type { BurstContext } from './types';

// Static pre-baked noise table, built once at module load.
const HARDWARE_RAND_TABLE = new Float32Array(1024);
const GOLD_HUES = [0xffd700, 0xffe9a8, 0xffc233, 0xfff4c2];

for (let i = 0; i < 1024; i++) {
  HARDWARE_RAND_TABLE[i] = Math.random() - 0.5;
}

/**
 * Kamuro / Brocade Crown: a huge, dense shower of light, low-drag golden
 * stars that barely feel gravity and keep emitting glitter continuously
 * (via `sparkleInterval`/`onSparkle`, each callback spawning through the
 * same shared `ctx.spawn`), so they hang and drift down together like an
 * umbrella of falling gold.
 *
 * Distribution and every per-particle random draw come from the static
 * `HARDWARE_RAND_TABLE`, indexed via `fastCosByIndex`/`fastSinByIndex` (safe
 * against out-of-range input by construction — no radian wrap needed,
 * unlike `fastCos`/`fastSin`). One live `Math.random()` call per burst
 * (`baseSeed`) rotates which slice of the table each explosion reads, so
 * repeated/overlapping bursts don't all draw an identical sequence.
 */
export function burstKamuro(x: number, y: number, ctx: BurstContext): void {
  // One live random seed per burst -> full spatial variety across
  // overlapping/repeated explosions.
  const baseSeed = Math.floor(Math.random() * 512);

  const count = Math.max(20, Math.round((85 + HARDWARE_RAND_TABLE[baseSeed & 1023] * 35) * ctx.densityRatio));
  const baseSpeed = (1.8 + HARDWARE_RAND_TABLE[(baseSeed + 7) & 1023] * 1.0) * ctx.settings.explosionScale;
  const hues = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : GOLD_HUES;

  const spawnSparkle = (sx: number, sy: number): void => {
    const randIdx = ((sx | 0) ^ (sy | 0)) & 1023;
    const color = hues[randIdx & 3];

    ctx.spawn({
      x: sx + HARDWARE_RAND_TABLE[(randIdx + 3) & 1023] * 4,
      y: sy + HARDWARE_RAND_TABLE[(randIdx + 13) & 1023] * 4,
      vx: HARDWARE_RAND_TABLE[(randIdx + 29) & 1023] * 0.3,
      vy: 0.12 + Math.abs(HARDWARE_RAND_TABLE[(randIdx + 41) & 1023]) * 0.2,
      color,
      size: (2 + Math.abs(HARDWARE_RAND_TABLE[(randIdx + 53) & 1023]) * 2) * ctx.glowSizeBoost,
      life: (26 + Math.abs(HARDWARE_RAND_TABLE[(randIdx + 67) & 1023]) * 22) * ctx.settings.lifespanScale,
      gravity: 0.035 * ctx.settings.gravityScale,
      drag: 0.975,
      twinkle: true,
    });
  };

  const angleStep = TABLE_SIZE / count;

  for (let i = 0; i < count; i++) {
    const loopSeed = (baseSeed + i) & 1023;

    const angleIndex = Math.round(i * angleStep + HARDWARE_RAND_TABLE[loopSeed] * 15) & 1023;
    const speed = baseSpeed * (0.7 + Math.abs(HARDWARE_RAND_TABLE[(loopSeed + 19) & 1023]) * 0.5);
    const color = hues[i & 3];

    ctx.spawn({
      x,
      y,
      vx: fastCosByIndex(angleIndex) * speed,
      vy: fastSinByIndex(angleIndex) * speed,
      color,
      size: (9 + Math.abs(HARDWARE_RAND_TABLE[(loopSeed + 31) & 1023]) * 5) * ctx.glowSizeBoost,
      life: (210 + Math.abs(HARDWARE_RAND_TABLE[(loopSeed + 47) & 1023]) * 90) * ctx.settings.lifespanScale,
      gravity: 0.045 * ctx.settings.gravityScale,
      drag: 0.994,
      sparkleInterval: 3 + Math.abs(HARDWARE_RAND_TABLE[(loopSeed + 61) & 1023]) * 2,
      onSparkle: spawnSparkle,
    });
  }
}
