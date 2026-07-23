import { Application, Container, Particle as PixiParticle, ParticleContainer, Sprite, Texture } from 'pixi.js';
import { getParticleTexture, getGlowTexture } from './textures';
import { ParticlePool } from './ParticlePool';
import { fastCos, fastSin, TWO_PI } from './SineTable';

// Static noise table, built once at module load — same convention as every
// burst pattern file. Walked via each instance's own advancing cursor (see
// nextRand()); a continuous 5s stream draws well past this table's own size
// (up to 450 sparks x 5 draws = 2250), but unlike a single simultaneous
// burst, sparks emitted seconds apart don't need decorrelation from each
// other, so wraparound reuse over that time is imperceptible.
const RANDOM_TABLE_SIZE = 512;
const RANDOM_MASK = RANDOM_TABLE_SIZE - 1;
const RANDOM_STRIDE = 131;
const randomTable = new Float32Array(RANDOM_TABLE_SIZE);
for (let i = 0; i < RANDOM_TABLE_SIZE; i++) randomTable[i] = Math.random();

const DURATION_SECONDS = 5;
const HEIGHT_RATIO = 0.25;
const CONE_HALF_ANGLE = ((12 * Math.PI) / 180) / 2;
const EMIT_RATE_PER_SEC = 90;
const GLOW_RADIUS = 46;
const SPARK_GRAVITY = 0.03;
const SPARK_VX_DRAG = 0.985;
const SPARK_VY_DRAG = 0.965;
const MAX_SPARKS = Math.ceil(EMIT_RATE_PER_SEC * DURATION_SECONDS);

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

  private readonly sparkParticles: (PixiParticle | null)[] = new Array(MAX_SPARKS);
  private readonly sparkX = new Float32Array(MAX_SPARKS);
  private readonly sparkY = new Float32Array(MAX_SPARKS);
  private readonly sparkVx = new Float32Array(MAX_SPARKS);
  private readonly sparkVy = new Float32Array(MAX_SPARKS);
  private liveSparkCount = 0;
  private age = 0;
  private emitAccumulator = 0;
  private emitting = true;
  /** Persistent walking cursor into the static `randomTable` — see `nextRand()`. */
  private rIdx: number;

  private readonly invTextureWidth: number;
  private readonly invTextureHeight: number;

  constructor(app: Application, x: number, y: number, parentLayer: Container) {
    this.app = app;
    this.baseX = x;
    this.baseY = y;
    this.maxRise = app.screen.height * HEIGHT_RATIO;
    this.texture = getParticleTexture();
    // Seeded from the ignition point instead of Math.random() — same
    // convention as every burst pattern function's own rIdx seed.
    this.rIdx = ((x | 0) ^ (y | 0)) & RANDOM_MASK;

    this.invTextureWidth = 1 / this.texture.width;
    this.invTextureHeight = 1 / this.texture.height;

    this.container = new Container();
    parentLayer.addChild(this.container);

    this.sparksContainer = new ParticleContainer({
      texture: this.texture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: false, vertex: true, uvs: false, color: false },
    });
    this.container.addChild(this.sparksContainer);

    this.pool = new ParticlePool<PixiParticle>(() => {
      const particle = new PixiParticle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      this.sparksContainer.addParticle(particle);
      return particle;
    });

    this.glow = new Sprite(getGlowTexture());
    this.glow.anchor.set(0.5);
    this.glow.width = GLOW_RADIUS * 2;
    this.glow.height = GLOW_RADIUS * 2;
    this.glow.position.set(x, y);
    this.glow.blendMode = 'add';
    this.glow.alpha = 0;
    this.container.addChild(this.glow);
  }

  get finished(): boolean {
    return !this.emitting && this.liveSparkCount === 0;
  }

  update(deltaFrames: number): void {
    const deltaSeconds = this.app.ticker.deltaMS / 1000;
    this.age += deltaSeconds;

    if (this.emitting) {
      if (this.age <= 0.3) {
        this.glow.alpha = (this.age / 0.3) * 0.35;
      } else {
        this.glow.alpha = 0.35;
      }
    } else {
      const densityRatio = this.liveSparkCount / EMIT_RATE_PER_SEC;
      const targetAlpha = densityRatio * 0.35;
      this.glow.alpha = targetAlpha < 0 ? 0 : targetAlpha > 0.35 ? 0.35 : targetAlpha;
    }

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

    let i = 0;
    const baseY = this.baseY;
    const maxRise = this.maxRise;

    while (i < this.liveSparkCount) {
      const particle = this.sparkParticles[i] as PixiParticle;

      const vx = this.sparkVx[i] * SPARK_VX_DRAG;
      const vy = this.sparkVy[i] * SPARK_VY_DRAG + SPARK_GRAVITY * deltaFrames;
      this.sparkVx[i] = vx;
      this.sparkVy[i] = vy;

      const nextX = this.sparkX[i] + vx * deltaFrames;
      const nextY = this.sparkY[i] + vy * deltaFrames;
      this.sparkX[i] = nextX;
      this.sparkY[i] = nextY;

      particle.x = (nextX + 0.5) | 0;
      particle.y = (nextY + 0.5) | 0;

      const rise = baseY - nextY;
      const riseRatio = rise < 0 ? 0 : rise > maxRise ? 1 : rise / maxRise;
      let alpha = 1;
      if (riseRatio >= 0.7) alpha = 1 - (riseRatio - 0.7) / 0.3;
      particle.alpha = alpha < 0 ? 0 : alpha;

      if (rise >= maxRise || alpha <= 0 || rise <= 0) {
        particle.alpha = 0;
        particle.scaleX = 0;
        particle.scaleY = 0;
        this.pool.push(particle);

        const last = --this.liveSparkCount;
        if (i !== last) {
          this.sparkParticles[i] = this.sparkParticles[last];
          this.sparkX[i] = this.sparkX[last];
          this.sparkY[i] = this.sparkY[last];
          this.sparkVx[i] = this.sparkVx[last];
          this.sparkVy[i] = this.sparkVy[last];
        }
        this.sparkParticles[last] = null;
      } else {
        i++;
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  /** Walks `randomTable` one step — zero live `Math.random()` calls. */
  private nextRand(): number {
    this.rIdx = (this.rIdx + RANDOM_STRIDE) & RANDOM_MASK;
    return randomTable[this.rIdx];
  }

  private spawnSpark(): void {
    if (this.liveSparkCount >= MAX_SPARKS) return;

    const randAngle = this.nextRand();
    const randSpeed = this.nextRand();
    const randColor = this.nextRand();
    const randSize = this.nextRand();
    const randX = this.nextRand();

    const rawAngle = -Math.PI / 2 + (randAngle - 0.5) * 2 * CONE_HALF_ANGLE;
    // fastCos/fastSin require a pre-wrapped [0, TWO_PI) input; rawAngle is
    // only ever slightly negative (CONE_HALF_ANGLE is a few degrees), so one
    // conditional add is enough, no wrap loop needed.
    const angle = rawAngle < 0 ? rawAngle + TWO_PI : rawAngle;
    const speed = 5 + randSpeed * 2;

    const particle = this.pool.pop();
    particle.tint = randColor < 0.5 ? 0xffcf6b : 0xffe9b3;

    const size = (5 + randSize * 3) | 0;
    particle.scaleX = size * this.invTextureWidth;
    particle.scaleY = size * this.invTextureHeight;
    particle.alpha = 1;

    const spawnX = this.baseX + (randX - 0.5) * 4;
    const spawnY = this.baseY;

    const idx = this.liveSparkCount++;
    this.sparkParticles[idx] = particle;
    this.sparkX[idx] = spawnX;
    this.sparkY[idx] = spawnY;

    particle.x = (spawnX + 0.5) | 0;
    particle.y = spawnY | 0;

    this.sparkVx[idx] = fastCos(angle) * speed;
    this.sparkVy[idx] = fastSin(angle) * speed;
  }
}
