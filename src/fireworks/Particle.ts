import { Sprite, Texture } from 'pixi.js';

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
  private readonly twinkle: boolean;

  private readonly sparkleInterval?: number;
  private readonly onSparkle?: (x: number, y: number) => void;
  private sparkleAccumulator = 0;

  private readonly splitAt?: number;
  private readonly onSplit?: (x: number, y: number, vx: number, vy: number) => void;
  private hasSplit = false;

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
    } = options;

    this.vx = vx;
    this.vy = vy;
    this.gravity = gravity;
    this.drag = drag;
    this.life = life;
    this.baseSize = size;
    this.twinkle = twinkle;
    this.sparkleInterval = sparkleInterval;
    this.onSparkle = onSparkle;
    this.splitAt = splitAt;
    this.onSplit = onSplit;

    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.blendMode = 'add';
    this.sprite.tint = color;
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
    this.sprite.alpha = Math.max(0, alpha);

    const scale = 0.4 + 0.6 * fade;
    this.sprite.width = this.baseSize * scale;
    this.sprite.height = this.baseSize * scale;

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
