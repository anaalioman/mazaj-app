import { Sprite, Texture } from 'pixi.js';
import type { BurstType } from './FireworksSystem';
import { lerpColor } from './Particle';
import { applyDragAndGravity, integratePosition } from './ParticlePhysics';

// No drag on the ascending shell (a real rocket doesn't visibly decelerate
// from air resistance over its short flight) — `drag = 1` leaves velocity
// untouched before gravity is added, same shared equation every other
// moving thing in `fireworks/` uses.
const NO_DRAG = 1;

// The ascending shell reads as a white-hot flare with just a hint of its
// eventual burst color, matching a real rocket's burning propellant —
// the full shell color shows up properly once it explodes (and in the
// colored trail sparks left behind it, see spawnTrailSpark).
const FLARE_COLOR_MIX = 0.3;

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
 *
 * Object pool member, same convention as `Particle`/`GroundFountain`'s own
 * sparks (see `ParticlePool.ts`): the constructor only ever runs once per
 * pooled instance (builds the one `Sprite` and adds it to the layer once),
 * and every actual launch — fresh or recycled — goes through `init()`.
 * `kill()` hides the sprite (`alpha = 0`) instead of destroying it, so
 * `FireworksSystem` can push a spent shell back to its `rocketPool` and the
 * next launch reuses it with zero allocation and zero
 * `addChild()`/`removeChild()` scenegraph churn.
 */
export class Rocket {
  readonly sprite: Sprite;
  color = 0xffffff;
  forcedType?: BurstType;
  onComplete?: () => void;

  private vy = 0;
  private readonly gravity = 0.16;
  private targetY = 0;
  private trailAccumulator = 0;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.blendMode = 'add';
    this.sprite.width = 10;
    this.sprite.height = 10;
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /** (Re)starts this shell — see the class's own pooling doc comment. Called both for a fresh instance and a recycled dead one. */
  init(options: RocketOptions): void {
    const { x, startY, targetY, color, forcedType, onComplete } = options;
    this.color = color;
    this.forcedType = forcedType;
    this.onComplete = onComplete;
    this.targetY = targetY;
    this.trailAccumulator = 0;

    // Initial speed derived from distance so shells launched at very
    // different heights still arc and slow down convincingly.
    const distance = Math.max(startY - targetY, 40);
    this.vy = -Math.sqrt(2 * this.gravity * distance) * 1.02;

    this.sprite.tint = lerpColor(0xffffff, color, FLARE_COLOR_MIX);
    this.sprite.alpha = 1;
    this.sprite.position.set(x, startY);
  }

  /** Returns true once the shell has reached its apex and should burst. */
  update(delta: number, onTrail: (x: number, y: number) => void): boolean {
    this.vy = applyDragAndGravity(this.vy, NO_DRAG, this.gravity, delta);
    this.sprite.y = integratePosition(this.sprite.y, this.vy, delta);

    this.trailAccumulator += delta;
    if (this.trailAccumulator >= 0.8) {
      this.trailAccumulator = 0;
      onTrail(this.sprite.x, this.sprite.y);
    }

    return this.vy >= -0.5 || this.sprite.y <= this.targetY;
  }

  /** Hides this shell without destroying its sprite — see the class's own pooling doc comment. Ready for `init()` to reuse immediately. */
  kill(): void {
    this.sprite.alpha = 0;
  }
}
