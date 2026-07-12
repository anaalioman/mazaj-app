import { Sprite, Texture } from 'pixi.js';
import type { BurstType } from './FireworksSystem';

export interface RocketOptions {
  x: number;
  startY: number;
  targetY: number;
  color: number;
  /** Forces a specific pattern on burst, bypassing the random/enabled-types pick — used by planned launches. */
  forcedType?: BurstType;
  /** Fires once this shell's explosion has fully finished playing (every descendant particle faded) — see FireworksSystem.launch(). */
  onComplete?: () => void;
}

/**
 * The ascending shell. Launches straight up, decelerating under gravity,
 * and reports back once it reaches its apex so the system can burst it.
 */
export class Rocket {
  readonly sprite: Sprite;
  readonly color: number;
  readonly forcedType?: BurstType;
  readonly onComplete?: () => void;

  private vy: number;
  private readonly gravity = 0.16;
  private readonly targetY: number;
  private trailAccumulator = 0;

  constructor(texture: Texture, options: RocketOptions) {
    const { x, startY, targetY, color, forcedType, onComplete } = options;
    this.color = color;
    this.forcedType = forcedType;
    this.onComplete = onComplete;
    this.targetY = targetY;

    // Initial speed derived from distance so shells launched at very
    // different heights still arc and slow down convincingly.
    const distance = Math.max(startY - targetY, 40);
    this.vy = -Math.sqrt(2 * this.gravity * distance) * 1.02;

    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.blendMode = 'add';
    this.sprite.tint = color;
    this.sprite.width = 10;
    this.sprite.height = 10;
    this.sprite.position.set(x, startY);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /** Returns true once the shell has reached its apex and should burst. */
  update(delta: number, onTrail: (x: number, y: number) => void): boolean {
    this.vy += this.gravity * delta;
    this.sprite.y += this.vy * delta;

    this.trailAccumulator += delta;
    if (this.trailAccumulator >= 0.8) {
      this.trailAccumulator = 0;
      onTrail(this.sprite.x, this.sprite.y);
    }

    return this.vy >= -0.5 || this.sprite.y <= this.targetY;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
