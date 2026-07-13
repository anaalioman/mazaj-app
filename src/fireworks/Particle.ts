import { Container, Sprite, Texture } from 'pixi.js';

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
export class Particle {
  /** A small Container wrapping the colored `trail` + white-hot `core` sprites — add/remove this as a single unit. */
  readonly sprite: Container;

  private readonly trail: Sprite;
  private readonly core: Sprite;
  private readonly coreTint: number;

  private vx: number;
  private vy: number;
  private readonly gravity: number;
  private readonly drag: number;
  private readonly life: number;
  private age = 0;
  private readonly baseSize: number;
  private readonly baseColor: number;
  private readonly twinkle: boolean;

  private readonly sparkleInterval?: number;
  private readonly onSparkle?: (x: number, y: number) => void;
  private sparkleAccumulator = 0;

  private readonly splitAt?: number;
  private readonly onSplit?: (x: number, y: number, vx: number, vy: number) => void;
  private hasSplit = false;

  private readonly strobe: boolean;
  private strobeTimer: number;
  private strobeOn = true;

  private readonly approachStrength: number;
  private readonly approachPeakRatio: number;

  constructor(texture: Texture, options: ParticleOptions) {
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

    this.vx = vx;
    this.vy = vy;
    this.gravity = gravity;
    this.drag = drag;
    this.life = life;
    this.baseSize = size;
    this.baseColor = color;
    this.twinkle = twinkle;
    this.sparkleInterval = sparkleInterval;
    this.onSparkle = onSparkle;
    this.splitAt = splitAt;
    this.onSplit = onSplit;
    this.strobe = strobe;
    this.strobeTimer = 3 + Math.random() * 10;
    this.coreTint = lerpColor(IGNITION_COLOR, color, CORE_COLOR_MIX);
    this.approachStrength =
      Math.random() < APPROACH_CHANCE ? APPROACH_MIN_STRENGTH + Math.random() * (APPROACH_MAX_STRENGTH - APPROACH_MIN_STRENGTH) : 0;
    this.approachPeakRatio = APPROACH_PEAK_MIN + Math.random() * (APPROACH_PEAK_MAX - APPROACH_PEAK_MIN);

    this.sprite = new Container();
    this.sprite.position.set(x, y);

    this.trail = new Sprite(texture);
    this.trail.anchor.set(0.5);
    this.trail.blendMode = 'add';
    this.trail.tint = IGNITION_COLOR; // stage 1 starts white-hot; update() takes over next tick
    this.trail.width = size;
    this.trail.height = size;
    this.sprite.addChild(this.trail);

    this.core = new Sprite(texture);
    this.core.anchor.set(0.5);
    this.core.blendMode = 'add';
    this.core.tint = this.coreTint;
    this.core.width = size * CORE_SIZE_RATIO;
    this.core.height = size * CORE_SIZE_RATIO;
    this.sprite.addChild(this.core);
  }

  /** Advances the particle. Returns false once it has expired or split. */
  update(delta: number): boolean {
    this.age += delta;
    if (this.age >= this.life) return false;

    this.vx *= this.drag;
    this.vy = this.vy * this.drag + this.gravity * delta;

    this.sprite.x += this.vx * delta;
    this.sprite.y += this.vy * delta;

    const lifeRatio = this.age / this.life;
    const fade = 1 - lifeRatio;
    let alpha = fade * fade;
    if (this.twinkle) {
      alpha *= 0.55 + 0.45 * Math.sin(this.age * 2.4 + this.sprite.x);
    }
    if (this.strobe) {
      this.strobeTimer -= delta;
      if (this.strobeTimer <= 0) {
        this.strobeOn = !this.strobeOn;
        // Re-randomized every flip so the blink speed itself varies, not just on/off.
        this.strobeTimer = 3 + Math.random() * 10;
      }
      alpha *= this.strobeOn ? 1 : 0.04;
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

    // Set once on the container: cascades to both the trail and core children.
    this.sprite.alpha = Math.max(0, Math.min(1, alpha));

    const scale = (0.4 + 0.6 * fade) * (1 + approach);
    const thickness = this.baseSize * scale;
    const speed = Math.hypot(this.vx, this.vy);
    const stretch = Math.min(speed * TRAIL_STRETCH_FACTOR, thickness * TRAIL_MAX_STRETCH_RATIO);
    const totalLength = thickness + stretch;

    this.trail.height = thickness;
    this.trail.width = totalLength;
    // Anchor slides from centered (stationary particle, looks like a plain
    // dot) toward the tail end (fast particle, position sits at the head)
    // as stretch grows, so there's never a visible jump between the two.
    this.trail.anchor.set(0.5 + 0.5 * (stretch / totalLength), 0.5);
    this.trail.rotation = Math.atan2(this.vy, this.vx);

    // The core always sits at the container's local origin — i.e. exactly at
    // the leading point the trail's sliding anchor tracks — so it reads as
    // the trail's hot tip, not a separate floating dot.
    this.core.width = thickness * CORE_SIZE_RATIO;
    this.core.height = thickness * CORE_SIZE_RATIO;

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
        this.onSparkle(this.sprite.x, this.sprite.y);
      }
    }

    if (!this.hasSplit && this.splitAt !== undefined && this.age >= this.splitAt) {
      this.hasSplit = true;
      this.onSplit?.(this.sprite.x, this.sprite.y, this.vx, this.vy);
      return false;
    }

    return true;
  }

  destroy(): void {
    this.sprite.destroy({ children: true });
  }
}
