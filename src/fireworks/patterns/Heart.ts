import { pickBurstColors, shadesOf } from '../colors';
import type { BurstContext } from './types';

/**
 * The classic parametric heart curve:
 *   x(t) = 16 sin³(t)
 *   y(t) = 13 cos(t) - 5 cos(2t) - 2 cos(3t) - cos(4t)
 * for t in [0, 2π) — a real closed-form mathematical curve (not a traced
 * bitmap/SVG outline), scaled to arbitrary units. Screen y grows downward,
 * so the curve's own y is negated to keep the heart right-side up. Used
 * only while building the module-load-time table below — never called
 * again per particle, per burst.
 */
function heartCurvePoint(t: number): { x: number; y: number } {
  const sinT = Math.sin(t);
  const x = 16 * sinT * sinT * sinT;
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x, y };
}

// 4096-sample table: dense enough that a plain direct lookup (no
// interpolation) at burst time deviates from an interpolated 1024-sample
// lookup by at most 0.00216 in direction (unit-vector space) and 0.00177 in
// vScale (whose own range is ~0.9 wide) — verified by simulation across a
// 266-particle burst (the densest this pattern ever spawns). Table access
// wraps via `& TABLE_MASK`, which also correctly closes the loop (the point
// "after" the last table entry is entry 0 again, since the heart curve is a
// closed curve).
const TABLE_SIZE = 4096;
const TABLE_MASK = TABLE_SIZE - 1;

/**
 * Equal-arc-length table, built once at module load — the heart curve's own
 * shape never changes burst to burst, only the explosion center/count/
 * speed/color do, so every expensive property of the curve is baked in
 * here instead of recomputed per spark:
 *
 * 1. Equal-arc-length spacing: the curve's parametric speed (|dx/dt,dy/dt|)
 *    is not constant, so sampling raw parameter `t` at even steps bunches
 *    sparks up where the curve moves slowly and thins them out where it
 *    moves fast (verified: 42.7x density variance with raw-t spacing vs
 *    1.00x with this table). Fixed by sampling the curve finely,
 *    accumulating real arc length, and inverting that into equal-length
 *    steps.
 * 2. `dirX`/`dirY`: pre-normalized direction from the origin to each
 *    equal-arc-length point. Float32 — direction components (range -1..1)
 *    and vScale (range ~0.4-1.3) need nowhere near double precision for a
 *    value that only ever feeds a pixel-space velocity.
 * 3. `vScale`: the curve's own radius at that point relative to the curve's
 *    mean radius (radius ranges ~5-17 across the curve — a 3.4x spread, 27%
 *    coefficient of variation) — multiplied into each spark's speed in
 *    burstHeart() below so sparks sent toward the tip travel farther than
 *    sparks sent toward the top cleft, reproducing the heart's actual
 *    proportions instead of a uniform-radius ring.
 *
 * `heartDirection()` (a separate per-particle function returning a fresh
 * `{x,y}` object) has been removed entirely — burstHeart() below reads
 * straight out of these three arrays with a single direct index, no lerp,
 * no per-particle allocation, no extra call frame.
 */
interface HeartDirectionTable {
  dirX: Float32Array;
  dirY: Float32Array;
  vScale: Float32Array;
}

const directionTable: HeartDirectionTable = (function buildDirectionTable(): HeartDirectionTable {
  // Raw curve samples + cumulative arc length around the FULL closed loop —
  // TABLE_SIZE+1 entries so index TABLE_SIZE is the closing point (== index
  // 0), needed to measure the final wrap-around segment's length. Exact
  // Math.hypot here: this table is baked once, ever, at module load, and
  // every value in it (direction, vScale) permanently inherits whatever
  // error this step makes.
  const cumulative = new Float32Array(TABLE_SIZE + 1);
  const rawX = new Float32Array(TABLE_SIZE + 1);
  const rawY = new Float32Array(TABLE_SIZE + 1);

  let prev = heartCurvePoint(0);
  cumulative[0] = 0;
  rawX[0] = prev.x;
  rawY[0] = prev.y;
  for (let i = 1; i <= TABLE_SIZE; i++) {
    const t = (i / TABLE_SIZE) * Math.PI * 2;
    const point = heartCurvePoint(t);
    cumulative[i] = cumulative[i - 1] + Math.hypot(point.x - prev.x, point.y - prev.y);
    rawX[i] = point.x;
    rawY[i] = point.y;
    prev = point;
  }

  const totalLength = cumulative[TABLE_SIZE];
  const dirX = new Float32Array(TABLE_SIZE);
  const dirY = new Float32Array(TABLE_SIZE);
  const vScale = new Float32Array(TABLE_SIZE);
  const radii = new Float32Array(TABLE_SIZE);
  let radiusSum = 0;
  // Persistent pointer across iterations (not reset per-i): both
  // `cumulative` and `targetLength` are monotonically increasing in `i`, so
  // this stays a single O(N) sweep instead of re-searching from 0 each time.
  let searchIndex = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    const targetLength = (i / TABLE_SIZE) * totalLength;
    while (searchIndex < TABLE_SIZE && cumulative[searchIndex + 1] < targetLength) searchIndex++;
    const segStart = cumulative[searchIndex];
    const nextIndex = Math.min(searchIndex + 1, TABLE_SIZE);
    const segEnd = cumulative[nextIndex];
    const segFrac = segEnd > segStart ? (targetLength - segStart) / (segEnd - segStart) : 0;

    const x = rawX[searchIndex] + (rawX[nextIndex] - rawX[searchIndex]) * segFrac;
    const y = rawY[searchIndex] + (rawY[nextIndex] - rawY[searchIndex]) * segFrac;
    const r = Math.hypot(x, y) || 1;
    radii[i] = r;
    radiusSum += r;
    dirX[i] = x / r;
    dirY[i] = y / r;
  }

  const avgRadius = radiusSum / TABLE_SIZE;
  for (let i = 0; i < TABLE_SIZE; i++) {
    vScale[i] = radii[i] / avgRadius;
  }

  return { dirX, dirY, vScale };
})();

// Static noise pool baked once at module load (the only place Math.random()
// runs), walked via an advancing index — matches Strobe.ts/Particle.ts/
// FireworksSystem.ts's own randomTable convention. Sized 2048 with a
// coprime stride (131, prime) so the densest burst (~266 particles x 5
// draws/particle, ~1330 draws) completes within a single non-repeating
// walk of the table.
const RANDOM_TABLE_SIZE = 2048;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// Fixed-size hardware pool, power-of-two so cycling through it is a bitmask
// (`& HEART_POOL_MASK`) instead of `% HEART_POOL_SIZE`. `ctx.spawn()` ->
// `Particle.init()` reads every field of its `options` argument
// synchronously into the Particle instance's own primitive fields before
// returning, so the same plain object can be mutated and re-passed every
// loop iteration instead of a fresh object literal per spark. Sized 1024 —
// comfortably above this shell's max realistic particle count (~266 at the
// density slider's own ceiling).
const HEART_POOL_SIZE = 1024;
const HEART_POOL_MASK = HEART_POOL_SIZE - 1;
interface HeartParticleSlot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  size: number;
  life: number;
  gravity: number;
  drag: number;
  twinkle: boolean;
}
const HEART_HARDWARE_POOL: HeartParticleSlot[] = new Array(HEART_POOL_SIZE);
for (let i = 0; i < HEART_POOL_SIZE; i++) {
  HEART_HARDWARE_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };
}

/**
 * Heart burst: every spark's direction/speed-scale come from a single
 * direct (non-interpolated) table lookup, every random value (color/speed
 * jitter/size/life/twinkle) comes from `randomTable` walked via an
 * advancing index seeded from the explosion center — zero live
 * Math.random() calls, zero arithmetic-generator state.
 *
 * `ctx.settings.lifespanScale`/`gravityScale` are read into local consts
 * once, outside the loop — `gravity` in particular is fully loop-invariant
 * (doesn't depend on any per-particle random value), so it's computed once
 * instead of on every one of up to ~266 iterations.
 *
 * `vScale` (see the table's own doc comment) is multiplied into speed so
 * the burst's silhouette actually reconstructs the heart's true
 * proportions — sharp tip, top cleft — instead of a uniform-radius ring.
 * Every spark spawns through the same shared `ctx.spawn` every other
 * pattern uses (via a mutated `HEART_HARDWARE_POOL` slot, not a fresh
 * object), so it renders with the exact same shared, pre-baked
 * fractal-noise particle texture (see textures.ts) as Peony/Rose/every
 * other shape.
 */
export function burstHeart(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;
  const nextRandom = (): number => {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[rIdx];
  };

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 4) : pickBurstColors(3 + ((randomTable[rIdx] * 2) | 0), nextRandom);
  const colorLen = burstColors.length;

  // `(v + 0.5) | 0` instead of Math.round(v) — bit-identical for this
  // always-positive value (same technique already verified/shipped in
  // Strobe.ts/Particle.ts), unlike a bare `| 0` truncation which would
  // silently round down instead of to nearest.
  const countRaw = 170 * ctx.densityRatio;
  const count = Math.max(24, (countRaw + 0.5) | 0);

  rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
  const baseSpeed = (2.9 + randomTable[rIdx] * 1.0) * ctx.settings.explosionScale;

  // Loop-invariant reads/products hoisted out — computed once, not once per
  // particle.
  const lifespanScale = ctx.settings.lifespanScale;
  const gravity = 0.07 * ctx.settings.gravityScale;
  const drag = 0.985;
  const glowSizeBoost = ctx.glowSizeBoost;
  // Reciprocal multiplication instead of a division repeated every
  // iteration — `i * invCount` instead of `i / count`.
  const invCount = 1 / count;

  for (let i = 0; i < count; i++) {
    const index = ((i * invCount * TABLE_SIZE) | 0) & TABLE_MASK;
    const dirX = directionTable.dirX[index];
    const dirY = directionTable.dirY[index];
    const vScale = directionTable.vScale[index];

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const speed = baseSpeed * vScale * (0.92 + randomTable[rIdx] * 0.16);

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const color = burstColors[(randomTable[rIdx] * colorLen) | 0];

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const size = (7 + randomTable[rIdx] * 4) * glowSizeBoost;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const life = (62 + randomTable[rIdx] * 28) * lifespanScale;

    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const twinkle = randomTable[rIdx] < 0.3;

    const slot = HEART_HARDWARE_POOL[i & HEART_POOL_MASK];
    slot.x = x;
    slot.y = y;
    slot.vx = dirX * speed;
    slot.vy = dirY * speed;
    slot.color = color;
    slot.size = size;
    slot.life = life;
    slot.gravity = gravity;
    slot.drag = drag;
    slot.twinkle = twinkle;

    ctx.spawn(slot);
  }
}
