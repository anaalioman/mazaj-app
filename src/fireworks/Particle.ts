import { Particle as PixiParticle, ParticleContainer, Texture } from 'pixi.js';
import { applyDrag, applyDragAndGravity, integratePosition } from './ParticlePhysics';
import { fastSin, TWO_PI } from './SineTable';

// Twinkle's wave speed — same 2.4 rad/frame the original Math.sin(this.age
// * 2.4 + this.x) advanced at; only the wrapping mechanism changed (see
// `twinkleTimer`'s own doc comment).
const TWINKLE_SPEED = 2.4;

// Strobe's flicker frequency range (rad/frame) — the on/off cadence is now
// a fixed-per-particle sine frequency, not a re-randomized interval timer.
const STROBE_FREQ_MIN = 1.6;
const STROBE_FREQ_MAX = 3.4;

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

/** Per-channel lerp via bit-shifting — no allocations, no texture/sprite work. */
export function lerpColor(from: number, to: number, t: number): number {
  const ratio = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = ((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * ratio;
  const g = ((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * ratio;
  const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * ratio;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
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
  /** Fixed once per spawn (see init()) — how fast this particle's on/off blink cycles. Not re-rolled per frame. */
  private strobeFrequency = 0;
  /** Wrapped in [0, TWO_PI) via a plain if each frame (see update()) — same convention as `twinkleTimer`, zero Math.random()/%/Math.floor in the per-frame path. */
  private strobeTimer = 0;

  private approachStrength = 0;
  private approachPeakRatio = 0;

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
    this.strobe = strobe;
    // One-time random pick at spawn (see strobeFrequency's own doc comment) — not the ticker.
    this.strobeFrequency = strobe ? STROBE_FREQ_MIN + Math.random() * (STROBE_FREQ_MAX - STROBE_FREQ_MIN) : 0;
    this.strobeTimer = 0;
    this.coreTint = lerpColor(IGNITION_COLOR, color, CORE_COLOR_MIX);
    this.approachStrength =
      Math.random() < APPROACH_CHANCE ? APPROACH_MIN_STRENGTH + Math.random() * (APPROACH_MAX_STRENGTH - APPROACH_MIN_STRENGTH) : 0;
    this.approachPeakRatio = APPROACH_PEAK_MIN + Math.random() * (APPROACH_PEAK_MAX - APPROACH_PEAK_MIN);

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

    this.vx = applyDrag(this.vx, this.drag);
    this.vy = applyDragAndGravity(this.vy, this.drag, this.gravity, delta);

    this.x = integratePosition(this.x, this.vx, delta);
    this.y = integratePosition(this.y, this.vy, delta);
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
      // Sine-driven flicker: a fixed per-particle frequency (set once at
      // spawn), thresholded at zero for a sharp on/off blink instead of
      // twinkle's smooth fade — no Math.random()/%/Math.floor in this path.
      this.strobeTimer += delta * this.strobeFrequency;
      if (this.strobeTimer >= TWO_PI) this.strobeTimer -= TWO_PI;
      alpha *= fastSin(this.strobeTimer) > 0 ? 1 : 0.04;
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
    const speed = Math.hypot(this.vx, this.vy);
    const stretch = Math.min(speed * TRAIL_STRETCH_FACTOR, thickness * TRAIL_MAX_STRETCH_RATIO);
    const totalLength = thickness + stretch;

    this.setScale(this.trail, totalLength, thickness);
    // Anchor slides from centered (stationary particle, looks like a plain
    // dot) toward the tail end (fast particle, position sits at the head)
    // as stretch grows, so there's never a visible jump between the two.
    this.trail.anchorX = 0.5 + 0.5 * (stretch / totalLength);
    this.trail.anchorY = 0.5;
    this.trail.rotation = Math.atan2(this.vy, this.vx);

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
