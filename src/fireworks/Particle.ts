import { Sprite, Texture } from 'pixi.js';

// Thermal Color Decay: every particle ignites white-hot, cools into its
// assigned shell color, then dies as dim ember ash. Boundaries are fractions
// of the particle's own lifespan, so short sparks and long willow trails both
// run the full curve at their own pace.
const FLASH_STAGE_END = 0.15;
const STABLE_STAGE_END = 0.75;
const IGNITION_COLOR = 0xffffff;
const COOLING_ASH_COLOR = 0xcc5500; // alternate embers-gone-cold tone: 0x882200

// Motion-streak trail: instead of spawning extra ghost sprites per particle
// (expensive at hundreds-on-screen), the existing sprite is simply stretched
// along its velocity and rotated to match — same single draw call, but reads
// as a fading comet tail thanks to the soft radial-gradient particle texture.
const TRAIL_STRETCH_FACTOR = 2.2;
const TRAIL_MAX_STRETCH_RATIO = 3; // tail length caps at 3x the particle's own thickness

/** Per-channel lerp via bit-shifting — no allocations, no texture/sprite work. */
function lerpColor(from: number, to: number, t: number): number {
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
  readonly sprite: Sprite;

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

    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.blendMode = 'add';
    this.sprite.tint = IGNITION_COLOR; // stage 1 starts white-hot; update() takes over next tick
    this.sprite.width = size;
    this.sprite.height = size;
    this.sprite.position.set(x, y);
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
    this.sprite.alpha = Math.max(0, alpha);

    const scale = 0.4 + 0.6 * fade;
    const thickness = this.baseSize * scale;
    const speed = Math.hypot(this.vx, this.vy);
    const stretch = Math.min(speed * TRAIL_STRETCH_FACTOR, thickness * TRAIL_MAX_STRETCH_RATIO);
    const totalLength = thickness + stretch;

    this.sprite.height = thickness;
    this.sprite.width = totalLength;
    // Anchor slides from centered (stationary particle, looks like a plain
    // dot) toward the tail end (fast particle, position sits at the head)
    // as stretch grows, so there's never a visible jump between the two.
    this.sprite.anchor.set(0.5 + 0.5 * (stretch / totalLength), 0.5);
    this.sprite.rotation = Math.atan2(this.vy, this.vx);

    // Thermal Color Decay: white ignition -> shell color -> cooling ash,
    // purely as a per-frame tint reassignment (no redraw, no new textures).
    if (lifeRatio < FLASH_STAGE_END) {
      this.sprite.tint = IGNITION_COLOR;
    } else if (lifeRatio < STABLE_STAGE_END) {
      const t = (lifeRatio - FLASH_STAGE_END) / (STABLE_STAGE_END - FLASH_STAGE_END);
      this.sprite.tint = lerpColor(IGNITION_COLOR, this.baseColor, t);
    } else {
      const t = (lifeRatio - STABLE_STAGE_END) / (1 - STABLE_STAGE_END);
      this.sprite.tint = lerpColor(this.baseColor, COOLING_ASH_COLOR, t);
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
    this.sprite.destroy();
  }
}
