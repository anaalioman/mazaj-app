import { Application, Container, Particle as PixiParticle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import { getParticleTexture, getGlowTexture } from './textures';
import { applyDrag, applyDragAndGravity, integratePosition } from './ParticlePhysics';
import { ParticlePool } from './ParticlePool';

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
// A gentle real gravity — enough that sparks visibly arc over and rain
// back down like a real gerb/fountain, not just decelerate and hang from
// drag alone. Deliberately much smaller than a burst spark's own
// gravity (0.06-0.12) since this effect is meant to read as a soft,
// floaty spray, not a falling ember.
const SPARK_GRAVITY = 0.03;
const SPARK_VX_DRAG = 0.985;
const SPARK_VY_DRAG = 0.965; // strong drag: visibly decelerates rather than arcing like a real burst

interface FountainSpark {
  particle: PixiParticle;
  vx: number;
  vy: number;
}

/**
 * Ground Fountain: a continuous, narrow-cone stream of sparks shooting up
 * from a fixed point for 5 seconds, capped at a strict height limit — unlike
 * every other burst here, this isn't a one-shot rocket explosion. Its
 * fade/kill rule is driven by height climbed, not elapsed life, which is why
 * it's its own small class rather than reusing the age-based `Particle`
 * class — but every other piece of infrastructure is shared, not
 * reinvented: sparks render through a real `ParticleContainer` (same
 * technique as `FireworksSystem`'s `trailsContainer`/`coresContainer`), are
 * recycled through the same generic `ParticlePool`, and move via the same
 * `ParticlePhysics` equations every other moving thing in `fireworks/` uses.
 * Contains zero logic about any of the seven burst patterns (Peony, Rose,
 * ...) — this file is the ground fountain and nothing else.
 */
export class GroundFountain {
  private readonly app: Application;
  private readonly container: Container;
  private readonly sparksContainer: ParticleContainer;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly maxRise: number;
  private readonly texture: Texture;
  private readonly glow: Sprite;
  private readonly pool: ParticlePool<PixiParticle>;

  private sparks: FountainSpark[] = [];
  private age = 0;
  private emitAccumulator = 0;
  private emitting = true;

  constructor(app: Application, x: number, y: number, parentLayer: Container) {
    this.app = app;
    this.baseX = x;
    this.baseY = y;
    this.maxRise = app.screen.height * HEIGHT_RATIO;
    this.texture = getParticleTexture();

    this.container = new Container();
    parentLayer.addChild(this.container);

    // Same batched-rendering technique as FireworksSystem's own particle
    // containers: every spark is a flat, same-texture PixiJS `Particle`
    // (not a Sprite/Container), so ~90 concurrent sparks cost one draw call.
    this.sparksContainer = new ParticleContainer({
      texture: this.texture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: false, vertex: true, uvs: false, color: true },
    });
    this.container.addChild(this.sparksContainer);

    this.pool = new ParticlePool<PixiParticle>(() => {
      const particle = new PixiParticle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      this.sparksContainer.addParticle(particle);
      return particle;
    });

    // A dedicated, perfectly smooth radial-gradient texture (not the grainy
    // spark texture) — a plain tinted/scaled Sprite instead of a Graphics
    // shape, so this effect needs zero geometry of its own, while still
    // reading as a soft ambient bloom with no hard/grainy edges.
    this.glow = new Sprite(getGlowTexture());
    this.glow.anchor.set(0.5);
    this.glow.tint = GLOW_COLOR;
    this.glow.width = GLOW_RADIUS * 2;
    this.glow.height = GLOW_RADIUS * 2;
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

    const particle = this.pool.pop();
    particle.tint = Math.random() < 0.5 ? 0xffcf6b : 0xffe9b3;
    const size = 5 + Math.random() * 3;
    // PixiJS's lightweight Particle has no width/height — only scaleX/scaleY
    // relative to its shared texture's own pixel size (same reasoning as
    // Particle.ts's own setScale() helper).
    particle.scaleX = size / this.texture.width;
    particle.scaleY = size / this.texture.height;
    particle.alpha = 1;
    particle.x = this.baseX + (Math.random() - 0.5) * 4;
    particle.y = this.baseY;

    this.sparks.push({ particle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  /** Returns false once the spark should be removed (hit the height cap or fully faded). */
  private advanceSpark(spark: FountainSpark, delta: number): boolean {
    spark.vx = applyDrag(spark.vx, SPARK_VX_DRAG);
    spark.vy = applyDragAndGravity(spark.vy, SPARK_VY_DRAG, SPARK_GRAVITY, delta);
    spark.particle.x = integratePosition(spark.particle.x, spark.vx, delta);
    spark.particle.y = integratePosition(spark.particle.y, spark.vy, delta);

    const rise = this.baseY - spark.particle.y;
    const riseRatio = Math.min(Math.max(rise / this.maxRise, 0), 1);
    const fadeStart = 0.7; // fades out over the final 30% of its climb
    const alpha = riseRatio < fadeStart ? 1 : 1 - (riseRatio - fadeStart) / (1 - fadeStart);
    spark.particle.alpha = Math.max(0, alpha);

    if (rise >= this.maxRise || alpha <= 0) {
      spark.particle.alpha = 0;
      spark.particle.scaleX = 0;
      spark.particle.scaleY = 0;
      this.pool.push(spark.particle);
      return false;
    }
    return true;
  }
}
