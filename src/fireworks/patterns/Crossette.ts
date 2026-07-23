import { pickBurstColors, shadesOf } from '../colors';
import { fastCosByIndex, fastSinByIndex, TABLE_SIZE } from '../SineTable';
import type { ParticleOptions } from '../Particle';
import type { BurstContext } from './types';

const TABLE_MASK = TABLE_SIZE - 1;
// Plain integer index-space jitter (no radians, no TWO_PI/Math.PI in the
// loop) — chosen to match the visual spread of the old ±0.075rad jitter
// (0.075/(2π)*1024 ≈ 12.2 steps either side), added directly to the base
// index before masking.
const ARM_JITTER_HALF_RANGE = 12;

// Static pre-computed randomness pool, built once at module load — same
// technique as every sibling pattern file. One shared advancing index per
// burst (`nextRandom()`) covers the arm loop, every arm-trail tick
// (`onSparkle`, spread across the arm's own life), and every split. Sized
// 8192: a single burst's true worst case (7 arms, each independently
// rolling its longest life at the lifespan slider's own max (2.5) further
// compounded by FireworksSystem's burstRandomHybrid() multiplier (~1.6x)
// and its shortest sparkle interval) reaches ~4237 total draws over that
// burst's full lifetime — verified by simulation, zero collisions at this
// size. The previous 1024-slot table already wrapped and repeated under
// ordinary settings (~916 draws at the *default* lifespan slider value),
// not just this extreme case.
const RANDOM_TABLE_SIZE = 8192;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// armCount = 5 + floor(rand*3) is exactly 5, 6, or 7 — a hard, exact
// ceiling (not a density-scaled estimate), so MAX_ARMS needs no margin.
const MAX_ARMS = 7;
const ARM_POOL: ParticleOptions[] = new Array(MAX_ARMS);
for (let i = 0; i < MAX_ARMS; i++) {
  ARM_POOL[i] = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };
}

// Shared, reused slot for every arm-trail tick, system-wide — trail ticks
// fire one at a time (each arm's own `sparkleInterval` ticks on
// FireworksSystem's single-threaded update loop, never concurrently), and
// `Particle.init()` copies every field synchronously the instant
// `ctx.spawn()` is called, so a single mutated slot is safe instead of a
// fresh object literal per tick (same pattern as Kamuro.ts's own
// `SPARKLE_SLOT`).
const TRAIL_SLOT: ParticleOptions = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: false };

// Two shared, reused slots for every split — a split always spawns exactly
// two particles back-to-back, synchronously, from the same call, so one
// slot per spawn call (not per arm) is enough; same safety reasoning as
// TRAIL_SLOT.
const SPLIT_SLOT_A: ParticleOptions = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: true };
const SPLIT_SLOT_B: ParticleOptions = { x: 0, y: 0, vx: 0, vy: 0, color: 0, size: 0, life: 0, gravity: 0, drag: 0, twinkle: true };

/**
 * Palm Tree Crossette: 5-7 thick arms fired from center like fronds; each
 * arm trails its own dust (`onSparkle`) and, right at the end of its life,
 * splits into two sparks fired opposite each other, perpendicular to the
 * arm (`onSplit`) instead of continuing straight.
 *
 * Arm directions are computed entirely in `SineTable`'s integer index space
 * (`fastCosByIndex`/`fastSinByIndex`) — the per-arm jitter is a plain
 * integer index offset, not a radian value, so no `Math.PI` conversion
 * happens in the loop. The split direction is exact perpendicular-vector
 * algebra (rotating (svx, svy) by ±90° is just (∓svy, ±svx)); its
 * normalization divides by `Math.sqrt(magSq)` directly — measured faster
 * than a hand-rolled fast-inverse-sqrt bit-trick in this engine (V8: native
 * sqrt ~286ms vs the bit-trick's ~321ms over 20M calls), so the trick bought
 * nothing here and is gone.
 *
 * Every trail tick and every split spawns through a shared, reused slot
 * (`TRAIL_SLOT`/`SPLIT_SLOT_A`/`SPLIT_SLOT_B`) instead of a fresh object
 * literal; every arm itself spawns through `ARM_POOL`. Each arm still needs
 * its own small closure (capturing that arm's own `color`) — trail/split
 * ticks for one arm can be interleaved in time with a *different*,
 * still-live shell's own arms (multiple Palm Crossette shells routinely
 * overlap in a real show), so a shared/reused *closure* (unlike a shared
 * *spawn slot*, which is only ever touched for the instant of one
 * synchronous spawn call) would have to tell those apart — not worth the
 * added complexity for an allocation this small (at most 7 tiny closures,
 * once per shell launch, not a per-frame cost).
 */
export function burstPalmCrossette(x: number, y: number, ctx: BurstContext): void {
  let rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;
  const nextRandom = (): number => {
    rIdx = (rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[rIdx];
  };

  const burstColors = ctx.activeColor !== null ? shadesOf(ctx.activeColor, 3) : pickBurstColors(3);
  const colorLen = burstColors.length;
  const armCount = 5 + ((nextRandom() * 3) | 0); // 5, 6, or 7
  const baseSpeed = (3.0 + nextRandom() * 1.4) * ctx.settings.explosionScale;
  const gravityScaleVal = ctx.settings.gravityScale;
  const lifespanScaleVal = ctx.settings.lifespanScale;
  const glowSizeBoostVal = ctx.glowSizeBoost;

  // 4 fully independent draws per trail tick, one per field — position
  // jitter (x, y) and velocity (vx, vy) each get their own value, so a
  // speck's spawn offset never determines its drift direction. Size/life
  // are fixed (not randomized): a background dust speck's exact size/life
  // variance wasn't visually load-bearing, so this drops 2 draws entirely
  // instead of coupling them to an unrelated field.
  const TRAIL_SIZE = 4;
  const TRAIL_LIFE = 21;
  const spawnArmTrail = (color: number, sx: number, sy: number): void => {
    const rx = nextRandom();
    const ry = nextRandom();
    const svx = (nextRandom() - 0.5) * 0.3;
    const svy = 0.1 + nextRandom() * 0.2;

    TRAIL_SLOT.x = sx + (rx - 0.5) * 3;
    TRAIL_SLOT.y = sy + (ry - 0.5) * 3;
    TRAIL_SLOT.vx = svx;
    TRAIL_SLOT.vy = svy;
    TRAIL_SLOT.color = color;
    TRAIL_SLOT.size = TRAIL_SIZE;
    TRAIL_SLOT.life = TRAIL_LIFE * lifespanScaleVal;
    TRAIL_SLOT.gravity = 0.03 * gravityScaleVal;
    TRAIL_SLOT.drag = 0.97;

    ctx.spawn(TRAIL_SLOT);
  };

  const spawnSplit = (color: number, sx: number, sy: number, svx: number, svy: number): void => {
    const magSq = svx * svx + svy * svy;
    const mag = Math.sqrt(magSq);
    const invMag = mag > 1e-6 ? 1 / mag : 0;
    const speed = mag * 0.7 > 1.6 ? mag * 0.7 : 1.6;

    // Two sparks perpendicular to the arm's own direction — 180° apart from
    // each other. Rotating (svx, svy) by +90°/-90° is exactly
    // (-svy, svx) / (svy, -svx) — no angle, no trig, no temporary array
    // (two explicit spawn calls with plain local scalars instead of a loop
    // over an array literal).
    const perp1x = -svy * invMag;
    const perp1y = svx * invMag;
    const perp2x = svy * invMag;
    const perp2y = -svx * invMag;

    const splitSize = 7 * glowSizeBoostVal;
    const splitLifeBase = (26 + nextRandom() * 16) * lifespanScaleVal;
    const splitGravity = 0.12 * gravityScaleVal;

    SPLIT_SLOT_A.x = sx;
    SPLIT_SLOT_A.y = sy;
    SPLIT_SLOT_A.vx = perp1x * speed;
    SPLIT_SLOT_A.vy = perp1y * speed;
    SPLIT_SLOT_A.color = color;
    SPLIT_SLOT_A.size = splitSize;
    SPLIT_SLOT_A.life = splitLifeBase;
    SPLIT_SLOT_A.gravity = splitGravity;
    SPLIT_SLOT_A.drag = 0.98;
    ctx.spawn(SPLIT_SLOT_A);

    SPLIT_SLOT_B.x = sx;
    SPLIT_SLOT_B.y = sy;
    SPLIT_SLOT_B.vx = perp2x * speed;
    SPLIT_SLOT_B.vy = perp2y * speed;
    SPLIT_SLOT_B.color = color;
    SPLIT_SLOT_B.size = splitSize;
    SPLIT_SLOT_B.life = splitLifeBase;
    SPLIT_SLOT_B.gravity = splitGravity;
    SPLIT_SLOT_B.drag = 0.98;
    ctx.spawn(SPLIT_SLOT_B);
  };

  // One small closure per arm (capturing that arm's own `color`) — see this
  // function's own doc comment for why this can't be a shared/reused
  // closure the way the spawn slots above are shared.
  const trailCallbacks: ((sx: number, sy: number) => void)[] = new Array(armCount);
  const splitCallbacks: ((sx: number, sy: number, svx: number, svy: number) => void)[] = new Array(armCount);

  for (let i = 0; i < armCount; i++) {
    const color = burstColors[i % colorLen];
    trailCallbacks[i] = (sx, sy) => spawnArmTrail(color, sx, sy);
    splitCallbacks[i] = (sx, sy, svx, svy) => spawnSplit(color, sx, sy, svx, svy);
  }

  for (let i = 0; i < armCount; i++) {
    const baseIndex = Math.round((i / armCount) * TABLE_SIZE);
    const jitterIndex = Math.round((nextRandom() - 0.5) * 2 * ARM_JITTER_HALF_RANGE);
    const thetaIndex = (baseIndex + jitterIndex) & TABLE_MASK;
    const speed = baseSpeed * (0.85 + nextRandom() * 0.3);
    const life = (55 + nextRandom() * 20) * lifespanScaleVal;

    const pObj = ARM_POOL[i];
    pObj.x = x;
    pObj.y = y;
    pObj.vx = fastCosByIndex(thetaIndex) * speed;
    pObj.vy = fastSinByIndex(thetaIndex) * speed;
    pObj.color = burstColors[i % colorLen];
    pObj.size = 16 * glowSizeBoostVal; // fixed thick-frond size
    pObj.life = life;
    pObj.gravity = 0.09 * gravityScaleVal;
    pObj.drag = 0.99;
    pObj.sparkleInterval = 2 + nextRandom() * 2;
    pObj.onSparkle = trailCallbacks[i];
    pObj.splitAt = life * 0.94; // right at the tip of the arm's life
    pObj.onSplit = splitCallbacks[i];

    ctx.spawn(pObj);
  }
}
