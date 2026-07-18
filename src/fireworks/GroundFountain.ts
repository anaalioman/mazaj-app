import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { getParticleTexture } from './textures';

const DURATION_SECONDS = 5;
// Sparks never climb higher than this fraction of the screen height above
// their spawn point, keeping the effect compact and the frame's middle/top
// clear for the background photo/video underneath.
const HEIGHT_RATIO = 0.25;
// Total cone spread of 12° (within the requested 10-15° range), narrow and
// tall rather than a wide aerial-burst spray.
const CONE_HALF_ANGLE = ((12 * Math.PI) / 180) / 2;
const EMIT_RATE_PER_SEC = 90;
const GLOW_COLOR = 0xffb347;
const GLOW_RADIUS = 46;

interface FountainSpark {
  sprite: Sprite;
  vx: number;
  vy: number;
}

/**
 * Ground Fountain: a continuous, narrow-cone stream of sparks shooting up
 * from a fixed point for 5 seconds, capped at a strict height limit — unlike
 * every other burst here, this isn't a one-shot rocket explosion. Reuses the
 * shared soft-circle particle texture for visual consistency, but is a
 * self-contained emitter (not built on the generic age-based Particle class)
 * since its fade/kill rule is driven by height climbed, not elapsed life.
 *
 * Sparks are pooled exactly like FireworksSystem's own `deadPool` (see its
 * doc comment): a dead spark's sprite is hidden (`alpha = 0`) and pushed to
 * `deadPool` instead of `removeChild()`+`destroy()`'d, so a 5s activation at
 * up to ~90 concurrent sparks does zero Sprite allocation/GC and zero
 * scenegraph child-list churn after the pool has warmed up.
 */
export class GroundFountain {
  private readonly app: Application;
  private readonly container: Container;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly maxRise: number;
  private readonly texture: Texture;
  private readonly glow: Graphics;

  private sparks: FountainSpark[] = [];
  private readonly deadPool: Sprite[] = [];
  private age = 0;
  private emitAccumulator = 0;
  private emitting = true;

  constructor(app: Application, x: number, y: number, parentLayer: Container) {
    this.app = app;
    this.baseX = x;
    this.baseY = y;
    this.maxRise = app.screen.height * HEIGHT_RATIO;
    this.texture = getParticleTexture(app);

    this.container = new Container();
    parentLayer.addChild(this.container);

    this.glow = new Graphics().circle(0, 0, GLOW_RADIUS).fill({ color: GLOW_COLOR, alpha: 1 });
    this.glow.position.set(x, y);
    this.glow.blendMode = 'add';
    this.glow.alpha = 0;
    this.container.addChild(this.glow);
  }

  /** True once the emitter has stopped and every spark it made has died out. */
  get finished(): boolean {
    return !this.emitting && this.sparks.length === 0;
  }

  update(deltaFrames: number): void {
    const deltaSeconds = this.app.ticker.deltaMS / 1000;
    this.age += deltaSeconds;

    // Ambient warm glow at the base: fades in over 0.3s, holds, fades out
    // over the final 0.6s — present for the whole 5s duration either way.
    const fadeIn = Math.min(this.age / 0.3, 1);
    const fadeOut = Math.min(Math.max((DURATION_SECONDS - this.age) / 0.6, 0), 1);
    this.glow.alpha = Math.min(fadeIn, fadeOut) * 0.35;

    if (this.emitting) {
      if (this.age >= DURATION_SECONDS) {
        this.emitting = false;
      } else {
        this.emitAccumulator += deltaSeconds * EMIT_RATE_PER_SEC;
        while (this.emitAccumulator >= 1) {
          this.emitAccumulator -= 1;
          this.spawnSpark();
        }
      }
    }

    this.sparks = this.sparks.filter((spark) => this.advanceSpark(spark, deltaFrames));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private spawnSpark(): void {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2 * CONE_HALF_ANGLE;
    const speed = 5 + Math.random() * 2;

    const sprite = this.deadPool.pop() ?? this.createSprite();
    sprite.tint = Math.random() < 0.5 ? 0xffcf6b : 0xffe9b3;
    const size = 5 + Math.random() * 3;
    sprite.width = size;
    sprite.height = size;
    sprite.alpha = 1;
    sprite.position.set(this.baseX + (Math.random() - 0.5) * 4, this.baseY);

    this.sparks.push({ sprite, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  /** Only ever called on a genuine pool miss (see `deadPool`'s own doc comment) — added to `container` exactly once, for its entire reused lifetime. */
  private createSprite(): Sprite {
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    this.container.addChild(sprite);
    return sprite;
  }

  /** Returns false once the spark should be removed (hit the height cap or fully faded). */
  private advanceSpark(spark: FountainSpark, delta: number): boolean {
    spark.vx *= 0.985;
    spark.vy *= 0.965; // strong drag: visibly decelerates rather than arcing like a real burst
    spark.sprite.x += spark.vx * delta;
    spark.sprite.y += spark.vy * delta;

    const rise = this.baseY - spark.sprite.y;
    const riseRatio = Math.min(Math.max(rise / this.maxRise, 0), 1);
    const fadeStart = 0.7; // fades out over the final 30% of its climb
    const alpha = riseRatio < fadeStart ? 1 : 1 - (riseRatio - fadeStart) / (1 - fadeStart);
    spark.sprite.alpha = Math.max(0, alpha);

    if (rise >= this.maxRise || alpha <= 0) {
      spark.sprite.alpha = 0;
      this.deadPool.push(spark.sprite);
      return false;
    }
    return true;
  }
}
