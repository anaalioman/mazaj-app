import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

const RANDOM_TABLE_SIZE = 1024;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 7;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

/**
 * Strobe / Glitter Shell: stars that randomly blink fully on/off (not a
 * smooth twinkle) at varying speeds as they fall, like sparkling diamond
 * fragments, before finally extinguishing. Same polar distribution as
 * Peony/Kamuro; `strobe: true` drives the on/off blink in `Particle.update()`
 * — a deltaTime-driven bitwise index toggle there (see its own doc
 * comment), not something this one-shot spawn function has any part of.
 */
export function burstStrobe(x: number, y: number, ctx: BurstContext): void {
  // Inlined index-advance instead of a `nextRandom()` closure — same
  // `(rIdx + RANDOM_STRIDE) & RANDOM_MASK` step repeated at each call site.
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 5) : pickBurstColors(4 + ((randomTable[rIdx] * 2) | 0));
  const colorLen = burstColors.length;
  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const countRaw = (110 + randomTable[rIdx] * 60) * ctx.densityRatio;
  const count = ((countRaw + 0.5) | 0) > 10 ? (countRaw + 0.5) | 0 : 10;
  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const baseSpeed = (2.6 + randomTable[rIdx] * 2.0) * ctx.settings.explosionScale;

  for (let i = 0; i < count; i++) {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const angle = (Math.PI * 2 * i) / count + randomTable[rIdx] * 0.4;
    const speed = ctx.fillSpeed(baseSpeed);
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const color = burstColors[(randomTable[rIdx] * colorLen) | 0];

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const size = (6 + randomTable[rIdx] * 4) * ctx.glowSizeBoost;
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const life = (90 + randomTable[rIdx] * 70) * ctx.settings.lifespanScale;

    ctx.spawn({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      size,
      life,
      gravity: 0.11 * ctx.settings.gravityScale,
      drag: 0.988,
      strobe: true,
    });
  }
}
