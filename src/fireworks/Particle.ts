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
}

// A single point of light: an explosion spark or a rocket trail dot.
// Moves under gravity + drag and fades out over its lifetime.
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

  constructor(texture: Texture, options: ParticleOptions) {
    const { x, y, vx, vy, color, size, life, gravity = 0.12, drag = 0.985, twinkle = false } = options;

    this.vx = vx;
    this.vy = vy;
    this.gravity = gravity;
    this.drag = drag;
    this.life = life;
    this.baseSize = size;
    this.twinkle = twinkle;

    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.blendMode = 'add';
    this.sprite.tint = color;
    this.sprite.width = size;
    this.sprite.height = size;
    this.sprite.position.set(x, y);
  }

  /** Advances the particle. Returns false once it has expired. */
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

    return true;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
