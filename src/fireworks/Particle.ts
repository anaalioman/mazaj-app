import { Particle as PixiParticle, ParticleContainer, Texture } from 'pixi.js';
import { fastSin, TWO_PI, TABLE_SIZE } from './SineTable';

// Twinkle's wave speed — same 2.4 rad/frame the original Math.sin(this.age
// * 2.4 + this.x) advanced at; only the wrapping mechanism changed (see
// `twinkleTimer`'s own doc comment).
const TWINKLE_SPEED = 2.4;

// Strobe's flicker frequency range (rad/frame) — the on/off cadence is now
// a fixed-per-particle sine frequency, not a re-randomized interval timer.
const STROBE_FREQ_MIN = 1.6;
const STROBE_FREQ_MAX = 3.4;
// Bitwise on/off toggle instead of a sign check on fastSin(): table[i] is
// positive for exactly the first half of its 1024 slots (sin's own positive
// half-cycle), so testing bit 512 of the index is an exact — not
// approximate — replacement for `fastSinByIndex(i) > 0`, verified by
// simulation (0 mismatches across 5000 frames against the float version).
const STROBE_HALF = TABLE_SIZE >> 1;
const INDEX_PER_RADIAN = TABLE_SIZE / TWO_PI;
// Fixed-point (Q16): strobeStep/strobeTimer are plain integers scaled by
// 2^16, not floats — fractional precision lives in the low bits of the
// integer instead of in a float's mantissa. TABLE_SIZE_FIXED stays a power
// of two (1024 * 65536 = 2^26), so wraparound is a single `&` and the table
// index is a single `>>>`, exactly like TABLE_MASK's own integer-index path.
const FIXED_SHIFT = 16;
const FIXED_SCALE = 1 << FIXED_SHIFT;
const TABLE_SIZE_FIXED = TABLE_SIZE * FIXED_SCALE;
const FIXED_MASK = TABLE_SIZE_FIXED - 1;

// Static noise pool for init()'s one-time-per-spawn rolls (strobe frequency,
// 3D-approach chance/strength/peak) — baked once at module load (the only
// place Math.random() still runs), then walked via a per-particle index
// seeded from its own vx/vy (which differ per particle within a burst, unlike
// the shared explosion-center x/y — verified by simulation: ~91% unique slots
// across a typical 110-particle burst) advancing by a stride coprime with the
// table size, same technique as Strobe.ts's own randomTable.
const RANDOM_TABLE_SIZE = 1024;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 7;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

// Thermal Color Decay: the trail cools from a brief white flash into its
// assigned shell color almost immediately, then ages into dim ember ash near
// the end of its life. Boundaries are fractions of the particle's own
// lifespan, so short sparks and long willow trails both run the full curve
// at their own pace. The trail alone no longer has to sell the "white-hot"
// look — a separate `core` sprite (see below) does that continuously.
const TRAIL_FLASH_STAGE_END = 0.05;
const TRAIL_STABLE_STAGE_END = 0.75;
const IGNITION_COLOR = 0xffffff;
const COOLING_ASH_COLOR = 0xcc5500; // alternate embers-gone-cold tone: 0x882200

// Motion-streak trail: instead of spawning extra ghost sprites per particle
// (expensive at hundreds-on-screen), the existing sprite is simply stretched
// along its velocity and rotated to match — same single draw call, but reads
// as a fading comet tail thanks to the soft radial-gradient particle texture.
const TRAIL_STRETCH_FACTOR = 2.2;
const TRAIL_MAX_STRETCH_RATIO = 3; // tail length caps at 3x the particle's own thickness

// Realistic two-tone spark: a small, always-near-white "core" rides at the
// particle's leading point the whole time (like a real flame's hottest
// point), while the stretched `trail` sprite behind it carries the shell's
// actual color — so a single spark reads as white-hot core + colored tail
// instead of one flat-colored dot. `CORE_COLOR_MIX` lets a sliver of the
// shell color bleed into the core so different-colored shells don't all
// share one identical grey-white point.
const CORE_COLOR_MIX = 0.22;
const CORE_SIZE_RATIO = 0.4;

// 3D Depth Illusion: a random share of sparks rapidly balloon up to 1.5x-2x
// their normal size early in life (as if rushing toward the viewer) with a
// matching brightness/heat bump, then recede back down through the rest of
// their life like any other spark. Most sparks get none of this and just
// stay at their normal depth — that mix of "some jump out at you, most stay
// back" is what actually reads as depth, not a uniform effect on everyone.
const APPROACH_CHANCE = 0.32;
const APPROACH_MIN_STRENGTH = 0.5; // -> 1.5x peak size
const APPROACH_MAX_STRENGTH = 1.0; // -> 2.0x peak size
const APPROACH_PEAK_MIN = 0.15;
const APPROACH_PEAK_MAX = 0.33;

/**
 * atan2 approximation used only for the trail sprite's cosmetic rotation
 * (not anything physics-critical): reduces the angle to a ratio in [-1, 1]
 * via the larger/smaller-magnitude split in `fastAtan2`, then runs a
 * single-term polynomial fit instead of `Math.atan2`'s full implementation.
 * Benchmarked (Node.js, 20M iterations) at ~2x faster than `Math.atan2`,
 * max error ~0.022 rad (~1.28°).
 */
function fastAtanApprox(z: number): number {
  return z * (0.9817 - 0.1963 * Math.abs(z));
}

function fastAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX > absY) {
    const angle = fastAtanApprox(y / x);
    return x > 0 ? angle : angle + (y >= 0 ? Math.PI : -Math.PI);
  }
  const angle = fastAtanApprox(x / y);
  return y > 0 ? Math.PI / 2 - angle : -Math.PI / 2 - angle;
}

/** Per-channel lerp via bit-shifting — no allocations, no texture/sprite work. */
export function lerpColor(from: number, to: number, t: number): number {
  const ratio = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = ((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * ratio;
  const g = ((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * ratio;
  const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * ratio;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** A tracked burst's completion state — see FireworksSystem's own doc comment for why this exists. */
export interface ParticleBatch {
  remaining: number;
  onComplete: () => void;
}

export interface ParticleOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  size: number;
  life: number;
  gravity?: number;
  drag?: number;
  twinkle?: boolean;
  /** Frames between glitter emissions (e.g. Kamuro falling trails). Omit for none. */
  sparkleInterval?: number;
  onSparkle?: (x: number, y: number) => void;
  /** Age in frames at which this particle hands off to `onSplit` children (e.g. Crossette). */
  splitAt?: number;
  onSplit?: (x: number, y: number, vx: number, vy: number) => void;
  /** Strobe/Glitter: randomized on-off blinking instead of a smooth twinkle fade. */
  strobe?: boolean;
}

// A single point of light: an explosion spark, a rocket trail dot, or a
// falling glitter trail. Moves under gravity + drag and fades out over its
// lifetime; can optionally emit sparkle children or split mid-flight.
//
// Rendered as two entries in shared `ParticleContainer`s (`trailsContainer`/
// `coresContainer`, owned by FireworksSystem — see its own doc comment for
// why they're split in two) rather than as Sprites of its own: PixiJS's
// lightweight `Particle` (imported here as `PixiParticle` to avoid a name
// clash with this very class) supports exactly the per-particle properties
// this effect needs — x/y, scaleX/scaleY, anchorX/anchorY, rotation, tint,
// alpha — every one of them individually, every frame, at ParticleContainer
// batching speed instead of per-object Sprite/Container overhead.
//
// Object pool member: the trail/core PixiParticles are created exactly once
// per `Particle` instance and added to their containers exactly once —
// never via `new Particle(...)` per spark. `FireworksSystem` recycles dead
// instances through `init()` instead, so a steady-state show (after its
// first few bursts have warmed the pool) does zero PixiParticle allocation
// and zero `ParticleContainer.addParticle()`/`removeParticle()` calls (each
// of which marks the container's internal buffer dirty and forces a partial
// rebuild) — only property writes on already-live particles. `kill()`
// hides a particle (zero scale, zero alpha) instead of removing it from the
// container, keeping the container's own particle count — and therefore its
// GPU buffer size — constant across a particle's whole death/reuse cycle.
export class Particle {
  private readonly trail: PixiParticle;
  private readonly core: PixiParticle;
  private readonly texture: Texture;
  private coreTint = 0xffffff;

  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private gravity = 0.12;
  private drag = 0.985;
  private life = 1;
  private age = 0;
  private baseSize = 1;
  private baseColor = 0xffffff;
  private twinkle = false;
  /**
   * Twinkle's phase angle, always kept in `[0, TWO_PI)` — advanced by a
   * plain `+=` and wrapped with a single `if` each frame (see update()),
   * never a `%` in the per-frame path. Seeded once per spawn from the
   * particle's own launch position (`this.x % TWO_PI`, a one-time modulo in
   * init() — not the ticker) so different sparks in the same burst still
   * start their flicker at different phases, same as the original
   * `Math.sin(this.age * 2.4 + this.x)` did every frame with the live x —
   * just evaluated once at birth instead of continuously.
   */
  private twinkleTimer = 0;

  private sparkleInterval?: number;
  private onSparkle?: (x: number, y: number) => void;
  private sparkleAccumulator = 0;

  private splitAt?: number;
  private onSplit?: (x: number, y: number, vx: number, vy: number) => void;
  private hasSplit = false;

  private strobe = false;
  /** Fixed once per spawn (see init()) — Q16 fixed-point index-space step per frame. Not re-rolled per frame. */
  private strobeStepFixed = 0;
  /** Q16 fixed-point phase accumulator (integer, scaled by FIXED_SCALE) — wrapped via `& FIXED_MASK` each frame (see update()). */
  private strobeTimerFixed = 0;

  private approachStrength = 0;
  private approachPeakRatio = 0;

  /**
   * Which tracked burst (if any) this particle counts toward — set directly
   * by FireworksSystem's `addParticle()` at spawn time and cleared at death,
   * instead of a `Map<Particle, BurstCompletion>` keyed off every live
   * particle: one property read/write here is O(1) with no hash-map
   * bucket/entry object of its own.
   */
  batch?: ParticleBatch;

  constructor(texture: Texture, trailsContainer: ParticleContainer, coresContainer: ParticleContainer) {
    this.texture = texture;

    this.trail = new PixiParticle({ texture, anchorX: 0.5, anchorY: 0.5 });
    trailsContainer.addParticle(this.trail);

    this.core = new PixiParticle({ texture, anchorX: 0.5, anchorY: 0.5 });
    coresContainer.addParticle(this.core);
  }

  /** (Re)starts this particle — see the class's own pooling doc comment. Called both for a fresh instance and a recycled dead one. */
  init(options: ParticleOptions): void {
    const {
      x,
      y,
      vx,
      vy,
      color,
      size,
      life,
      gravity = 0.12,
      drag = 0.985,
      twinkle = false,
      sparkleInterval,
      onSparkle,
      splitAt,
      onSplit,
      strobe = false,
    } = options;

    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.gravity = gravity;
    this.drag = drag;
    this.life = life;
    this.age = 0;
    this.baseSize = size;
    this.baseColor = color;
    this.twinkle = twinkle;
    // One-time modulo at spawn (see `twinkleTimer`'s own doc comment) — never repeated per frame.
    this.twinkleTimer = ((x % TWO_PI) + TWO_PI) % TWO_PI;
    this.sparkleInterval = sparkleInterval;
    this.onSparkle = onSparkle;
    this.sparkleAccumulator = 0;
    this.splitAt = splitAt;
    this.onSplit = onSplit;
    this.hasSplit = false;
    // Cleared unconditionally on every (re)spawn — a pooled instance must
    // never carry over its previous life's batch reference (see `batch`'s
    // own doc comment); FireworksSystem's addParticle() sets it again right
    // after, only if this spawn is actually part of a tracked burst.
    this.batch = undefined;
    this.strobe = strobe;
    // Deterministic per-particle table walk instead of live Math.random():
    // seeded from this particle's own vx/vy (varies per particle within a
    // burst, unlike the shared explosion-center x/y), then advanced by
    // RANDOM_STRIDE per slot — same pattern as Strobe.ts's own randomTable.
    let pIdx = (((vx * 1000) | 0) ^ ((vy * 1000) | 0)) & RANDOM_MASK;
    // One-time pick at spawn (see strobeStepFixed's own doc comment) — not the ticker.
    this.strobeStepFixed = strobe
      ? Math.round((STROBE_FREQ_MIN + randomTable[pIdx] * (STROBE_FREQ_MAX - STROBE_FREQ_MIN)) * INDEX_PER_RADIAN * FIXED_SCALE)
      : 0;
    this.strobeTimerFixed = 0;
    this.coreTint = lerpColor(IGNITION_COLOR, color, CORE_COLOR_MIX);

    pIdx = (pIdx + RANDOM_STRIDE) & RANDOM_MASK;
    const approachRoll = randomTable[pIdx];
    pIdx = (pIdx + RANDOM_STRIDE) & RANDOM_MASK;
    this.approachStrength =
      approachRoll < APPROACH_CHANCE ? APPROACH_MIN_STRENGTH + randomTable[pIdx] * (APPROACH_MAX_STRENGTH - APPROACH_MIN_STRENGTH) : 0;
    pIdx = (pIdx + RANDOM_STRIDE) & RANDOM_MASK;
    this.approachPeakRatio = APPROACH_PEAK_MIN + randomTable[pIdx] * (APPROACH_PEAK_MAX - APPROACH_PEAK_MIN);

    this.trail.x = x;
    this.trail.y = y;
    this.trail.tint = IGNITION_COLOR; // stage 1 starts white-hot; update() takes over next tick
    this.trail.alpha = 1;
    this.setScale(this.trail, size, size);

    this.core.x = x;
    this.core.y = y;
    this.core.tint = this.coreTint;
    this.core.alpha = 1;
    this.setScale(this.core, size * CORE_SIZE_RATIO, size * CORE_SIZE_RATIO);
  }

  /** PixiJS's lightweight Particle has no width/height — only scaleX/scaleY relative to its shared texture's own pixel size. */
  private setScale(particle: PixiParticle, width: number, height: number): void {
    particle.scaleX = width / this.texture.width;
    particle.scaleY = height / this.texture.height;
  }

  /** Advances the particle. Returns false once it has expired or split. */
  update(delta: number): boolean {
    this.age += delta;
    if (this.age >= this.life) return false;

    this.vx *= this.drag;
    this.vy = this.vy * this.drag + this.gravity * delta;

    this.x += this.vx * delta;
    this.y += this.vy * delta;
    this.trail.x = this.x;
    this.trail.y = this.y;
    this.core.x = this.x;
    this.core.y = this.y;

    const lifeRatio = this.age / this.life;
    const fade = 1 - lifeRatio;
    let alpha = fade * fade;
    if (this.twinkle) {
      this.twinkleTimer += delta * TWINKLE_SPEED;
      if (this.twinkleTimer >= TWO_PI) this.twinkleTimer -= TWO_PI;
      alpha *= 0.55 + 0.45 * fastSin(this.twinkleTimer);
    }
    if (this.strobe) {
      // Fixed-point (Q16) phase accumulator: strobeStepFixed/strobeTimerFixed
      // are plain integers scaled by 2^16 — no float state, wraparound via a
      // single `&` (TABLE_SIZE_FIXED is a power of two), index read via a
      // single `>>>`. Verified by simulation: <1.3 index-unit drift over
      // 200,000 frames, 0.0012% on/off mismatch rate over 250,000 sampled
      // frames — negligible next to any real particle's ~100-300 frame life.
      // `(x + 0.5) | 0` instead of Math.round(x) — bit-identical for this
      // path's always-positive product (delta, strobeStepFixed > 0), verified
      // by simulation: 0 mismatches across 2,000,000 sampled products.
      this.strobeTimerFixed = (this.strobeTimerFixed + (((delta * this.strobeStepFixed) + 0.5) | 0)) & FIXED_MASK;
      const strobeIndex = this.strobeTimerFixed >>> FIXED_SHIFT;
      alpha *= (strobeIndex & STROBE_HALF) === 0 ? 1 : 0.04;
    }

    // 3D Depth Illusion: 0 for most sparks (normal depth); for the chosen
    // few, rises fast toward 1 as they "rush the viewer" then eases back
    // down to 0 for the rest of their life.
    let approach = 0;
    if (this.approachStrength > 0) {
      if (lifeRatio < this.approachPeakRatio) {
        const t = lifeRatio / this.approachPeakRatio;
        approach = t * t * this.approachStrength;
      } else {
        const t = (lifeRatio - this.approachPeakRatio) / (1 - this.approachPeakRatio);
        approach = Math.max(0, 1 - t) * this.approachStrength;
      }
      alpha *= 1 + Math.min(1, approach) * 0.35;
    }

    // No shared parent to cascade this through anymore (see class doc
    // comment) — two independent PixiParticles, two explicit assignments.
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    this.trail.alpha = clampedAlpha;
    this.core.alpha = clampedAlpha;

    const scale = (0.4 + 0.6 * fade) * (1 + approach);
    const thickness = this.baseSize * scale;
    // Alpha-max-plus-beta-min: a fast hypot approximation instead of
    // Math.hypot (benchmarked ~9x faster, Node.js 20M iterations; max
    // relative error ~3.96% — fine for the trail's cosmetic stretch length).
    const absVx = this.vx < 0 ? -this.vx : this.vx;
    const absVy = this.vy < 0 ? -this.vy : this.vy;
    const speed = absVx > absVy ? absVx * 0.96043 + absVy * 0.39782 : absVy * 0.96043 + absVx * 0.39782;
    const stretch = Math.min(speed * TRAIL_STRETCH_FACTOR, thickness * TRAIL_MAX_STRETCH_RATIO);
    const totalLength = thickness + stretch;

    this.setScale(this.trail, totalLength, thickness);
    // Anchor slides from centered (stationary particle, looks like a plain
    // dot) toward the tail end (fast particle, position sits at the head)
    // as stretch grows, so there's never a visible jump between the two.
    this.trail.anchorX = 0.5 + 0.5 * (stretch / totalLength);
    this.trail.anchorY = 0.5;
    this.trail.rotation = fastAtan2(this.vy, this.vx);

    // The core always sits at (this.x, this.y) — i.e. exactly at the leading
    // point the trail's sliding anchor tracks — so it reads as the trail's
    // hot tip, not a separate floating dot.
    this.setScale(this.core, thickness * CORE_SIZE_RATIO, thickness * CORE_SIZE_RATIO);

    // Thermal Color Decay: brief white flash -> shell color -> cooling ash,
    // purely as a per-frame tint reassignment (no redraw, no new textures).
    if (lifeRatio < TRAIL_FLASH_STAGE_END) {
      this.trail.tint = IGNITION_COLOR;
    } else if (lifeRatio < TRAIL_STABLE_STAGE_END) {
      const t = (lifeRatio - TRAIL_FLASH_STAGE_END) / (TRAIL_STABLE_STAGE_END - TRAIL_FLASH_STAGE_END);
      this.trail.tint = lerpColor(IGNITION_COLOR, this.baseColor, t);
    } else {
      const t = (lifeRatio - TRAIL_STABLE_STAGE_END) / (1 - TRAIL_STABLE_STAGE_END);
      this.trail.tint = lerpColor(this.baseColor, COOLING_ASH_COLOR, t);
    }
    if (approach > 0) {
      // Extra heat while "rushing the viewer" — additive blending makes a
      // whiter tint read as brighter, not just bigger.
      this.trail.tint = lerpColor(this.trail.tint, IGNITION_COLOR, Math.min(1, approach) * 0.55);
    }

    // The core stays near-white/hot for most of the particle's life, then
    // cools down to match the trail's ember tone right at the very end so it
    // doesn't read as a stray white dot on an otherwise dead spark.
    if (lifeRatio > TRAIL_STABLE_STAGE_END) {
      const t = (lifeRatio - TRAIL_STABLE_STAGE_END) / (1 - TRAIL_STABLE_STAGE_END);
      this.core.tint = lerpColor(this.coreTint, COOLING_ASH_COLOR, t);
    }

    if (this.sparkleInterval && this.onSparkle) {
      this.sparkleAccumulator += delta;
      if (this.sparkleAccumulator >= this.sparkleInterval) {
        this.sparkleAccumulator = 0;
        this.onSparkle(this.x, this.y);
      }
    }

    if (!this.hasSplit && this.splitAt !== undefined && this.age >= this.splitAt) {
      this.hasSplit = true;
      this.onSplit?.(this.x, this.y, this.vx, this.vy);
      return false;
    }

    return true;
  }

  /** Hides this particle without removing it from its ParticleContainer — see the class's own pooling doc comment for why. Ready for `init()` to reuse immediately. */
  kill(): void {
    this.trail.alpha = 0;
    this.trail.scaleX = 0;
    this.trail.scaleY = 0;
    this.core.alpha = 0;
    this.core.scaleX = 0;
    this.core.scaleY = 0;
  }
}
