import { Application, ColorMatrixFilter, Container, ParticleContainer, Rectangle } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { Particle, type ParticleOptions } from './Particle';
import { ParticlePool } from './ParticlePool';
import { Rocket } from './Rocket';
import { GroundFountain } from './GroundFountain';
import { getParticleTexture } from './textures';
import { randomColor, randomPalette } from './colors';
import { ALL_BURST_TYPES, DEFAULT_BURST_SETTINGS, type BurstSettings, type BurstType } from './burstTypes';
import { BURST_PATTERNS, type BurstContext } from './patterns';

export { ALL_BURST_TYPES, DEFAULT_BURST_SETTINGS, type BurstSettings, type BurstType } from './burstTypes';

const MIN_LAUNCH_INTERVAL = 0.9;
const MAX_LAUNCH_INTERVAL = 2.4;

// See launch()'s own doc comment: keeps a burst's ignition point far enough
// from the screen edge that most of its own radius stays on-screen.
const EDGE_MARGIN_RATIO = 0.2;
const EDGE_MARGIN_MAX = 90;

// Particles spawned by one explosion, relative to this, become its "shake
// intensity" — dense bursts (peony, rose, multi-ring) shake noticeably,
// thin ones (a handful of crossette arms) don't shake at all.
const BURST_INTENSITY_REFERENCE_COUNT = 150;

export interface FireworksSystemOptions {
  autoLaunch?: boolean;
  onLaunch?: (x: number) => void;
  /** `intensity` is roughly 0-1.5, scaled by how many particles the burst spawned. */
  onExplode?: (x: number, y: number, intensity: number) => void;
}

/**
 * Tracks one explosion's real, full visual lifetime — including every
 * deferred child a burst spawns after the initial spread (Kamuro's falling
 * glitter, Crossette's arm-tip splits) — so `onComplete` fires exactly once
 * every last descendant particle has actually faded out, not on a fixed
 * timer. See `launch()`'s `onComplete` param and `addParticle()`.
 */
interface BurstCompletion {
  remaining: number;
  onComplete: () => void;
}

/**
 * Owns every rocket and spark on screen: spawning, physics, and cleanup.
 * `update()` is meant to be driven from the Pixi ticker each frame. Every
 * burst *pattern* (peony, kamuro, heart, ...) lives as an independent
 * function under `patterns/` — this class owns the shared particle
 * containers, settings, and completion-tracking those pattern functions are
 * handed via a `BurstContext` (see `buildContext()`), but has no burst-shape
 * math of its own.
 */
export class FireworksSystem {
  private readonly app: Application;
  /** Public so fireworksMood.ts can reparent it into worldContainer (scene content, must be excluded from snapshot/recording UI-exclusion — see fireworksMood.ts's own container-tree doc comment). */
  readonly layer: Container;
  /**
   * Every spark's colored, stretched trail — and every spark's white-hot
   * core (see `coresContainer` below) — lives in a shared `ParticleContainer`
   * instead of each spark owning its own Container/Sprite pair. A
   * `ParticleContainer` batches thousands of flat particles (position,
   * scale, rotation, tint, alpha — everything `Particle.ts` needs) into a
   * handful of draw calls via its own dedicated GPU render pipe, instead of
   * the normal per-object Container instruction path. Split into two
   * (trails vs. cores) because each needs its own texture-independent
   * per-particle anchor/rotation state, and a ParticleContainer requires all
   * its particles to share one uniform set of "dynamic" properties.
   */
  private readonly trailsContainer: ParticleContainer;
  /** The white-hot leading-tip particles — see `trailsContainer` above. */
  private readonly coresContainer: ParticleContainer;
  private readonly glowFilter: AdvancedBloomFilter;
  /** Counteracts bloom's own tendency to bleed very bright, saturated bursts toward white in their hottest core — a native `pixi.js` filter (not `pixi-filters`), always active regardless of the glow slider. */
  private readonly colorFilter: ColorMatrixFilter;
  private readonly onLaunch?: (x: number) => void;
  private readonly onExplode?: (x: number, y: number, intensity: number) => void;

  private rockets: Rocket[] = [];
  private particles: Particle[] = [];
  // Particles spawned mid-tick (Kamuro glitter, Crossette splits) land here
  // first and get merged in once, after both filter passes below finish —
  // mutating `particles` while `Array.prototype.filter` is iterating it
  // would silently drop anything pushed past the loop's captured length.
  private pendingSpawns: Particle[] = [];
  // Which particles belong to which tracked burst — see BurstCompletion.
  private readonly particleWatchers = new Map<Particle, BurstCompletion>();
  // Object pool (see ParticlePool.ts's own doc comment): dead particles land
  // here via `kill()` instead of being discarded, and `spawnParticle()`
  // reuses one via `init()` before ever allocating a new instance. A show's
  // first few bursts still allocate (the pool starts empty and grows to the
  // high-water mark of concurrent live particles), but every burst after
  // that reuses entirely — zero `new Particle(...)`, zero
  // `ParticleContainer.addParticle()`/`removeParticle()` calls. Constructed
  // in the constructor body (not inline here) since its factory closes over
  // `trailsContainer`/`coresContainer`, which don't exist yet at this point.
  private readonly particlePool: ParticlePool<Particle>;

  private settings: BurstSettings = { ...DEFAULT_BURST_SETTINGS };
  private enabledTypes: BurstType[] = [...ALL_BURST_TYPES];
  private randomModeEnabled = false;
  // The player's "dye this shell" color-picker choice (see PlanningScreen's
  // color panel) — null means "متعدد الألوان": fall back to the normal
  // random palettes below. Every burst/launch color pick consults this
  // first instead of taking a signature change, so the existing planning/
  // launch call sites (PlanningMode, launchPlannedShow) never had to change.
  private activeColor: number | null = null;

  private fountains: GroundFountain[] = [];
  private groundFountainModeEnabled = false;

  private autoLaunchEnabled: boolean;
  private timeToNextAutoLaunch: number;

  /**
   * Wall-clock time (`performance.now()` delta, milliseconds) the most
   * recent explosion's particle-spawn loop took — i.e. exactly the burst
   * pattern function's own synchronous CPU cost, isolated from rendering.
   * Real measurement, read live in DevTools/a debug script; not a claim.
   */
  lastBurstSpawnMs = 0;

  constructor(app: Application, options: FireworksSystemOptions = {}) {
    this.app = app;
    // Deliberately a plain Container, not `{ isRenderGroup: true }`: an
    // earlier version of this file marked it a render group, reasoning that
    // `layer`'s own top-level children (just the two ParticleContainers +
    // occasional Rocket sprites) are stable frame-to-frame. That reasoning
    // didn't account for combining a render group with a container-level
    // filter (`glowFilter` below) on top of content whose *visual* bounds
    // grow explosively every frame during a burst — a real gap given this
    // codebase currently has no way to verify render-group/filter
    // compositing on real Android GPU drivers from this environment.
    // Reverted to standard rendering rather than defend a speculative
    // optimization it can't actually verify is safe.
    this.layer = new Container();
    app.stage.addChild(this.layer);
    this.onLaunch = options.onLaunch;
    this.onExplode = options.onExplode;

    const texture = getParticleTexture(app);
    // `vertex: true` covers both scale *and* anchor (PixiJS bakes both into
    // one "vertex" GPU attribute — see particleData.ts upstream) — required
    // since every spark's thickness/stretch/anchor changes every frame.
    // `rotation`/`color` dynamic for the same reason (velocity-angle spin,
    // thermal color decay); `uvs` stays static since every particle shares
    // the exact same full, uncropped texture. `blendMode: 'add'` matches
    // every spark's own additive glow, uniformly, for the whole batch.
    this.trailsContainer = new ParticleContainer({
      texture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: true, vertex: true, uvs: false, color: true },
    });
    this.layer.addChild(this.trailsContainer);
    // Cores never rotate (always a plain circle), so rotation stays static.
    this.coresContainer = new ParticleContainer({
      texture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: false, vertex: true, uvs: false, color: true },
    });
    this.layer.addChild(this.coresContainer);

    this.particlePool = new ParticlePool<Particle>(() => new Particle(texture, this.trailsContainer, this.coresContainer));

    // True bloom (bright-pass extract + blur + additive-style composite),
    // not a flat blur — only genuinely bright pixels (white-hot ignition,
    // hot embers) bleed light into the dark around them. `quality: 4` is a
    // deliberate mid-range-Android compromise (KawaseBlur's default is 4);
    // drop it further if a real device shows an FPS hit.
    this.glowFilter = new AdvancedBloomFilter({ threshold: 0.4, blur: 6, quality: 4, bloomScale: 1.2, brightness: 1 });
    this.colorFilter = new ColorMatrixFilter();
    this.colorFilter.saturate(0.35, false);
    this.applyGlow();

    // Pixi's own docs are explicit about why this matters: without a fixed
    // `filterArea`, a filtered container's processing region is *recomputed
    // from its own display-object bounds every single frame* — and `layer`'s
    // bounds are exactly as volatile as the particles inside it, growing and
    // shrinking continuously through every burst. A fixed rect matching the
    // screen (their own documented example) makes the bloom filter's
    // intermediate render target a stable size/position every frame instead
    // — a real device screenshot showed a rectangular tonal artifact
    // tracking the live particle bounds, consistent with exactly this
    // per-frame-bounds-recompute behavior.
    this.layer.filterArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    app.renderer.on('resize', () => {
      this.layer.filterArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    });

    this.autoLaunchEnabled = options.autoLaunch ?? true;
    this.timeToNextAutoLaunch = this.randomLaunchDelay();
  }

  /**
   * Launches a shell toward (x, targetY). Defaults to a random apex height.
   * `forcedType` overrides the random/enabled-types pick on burst — used by
   * planned (mass/sequential) launches. `onComplete`, if given, fires once
   * every particle this specific explosion spawns (including deferred
   * children like Kamuro glitter or Crossette splits) has actually faded —
   * not on a fixed delay.
   */
  launch(x: number, targetY?: number, forcedType?: BurstType, onComplete?: () => void): void {
    const { width, height } = this.app.screen;
    const apex = targetY ?? height * (0.15 + Math.random() * 0.45);
    const color = this.activeColor ?? randomColor(randomPalette());
    // Reads live app.screen.width every call (not a cached value), so this
    // stays correct across resize/rotation on its own. The margin itself is
    // proportional to screen width, not a flat 20px: a burst's own radius
    // (outer sparks travel roughly speed/(1-drag) px before drag exhausts
    // them — several hundred px for the denser patterns) is large relative
    // to a phone-width screen, so a shell ignited within a thin 20px strip
    // of the edge had over half its own burst radius clipped by the canvas
    // edge. `EDGE_MARGIN_RATIO` keeps the ignition point far enough in that
    // most of a typical burst's radius lands on-screen, capped so it
    // doesn't eat the whole width on very narrow devices.
    const margin = Math.min(width * EDGE_MARGIN_RATIO, EDGE_MARGIN_MAX);
    const clampedX = Math.min(Math.max(x, margin), width - margin);

    const rocket = new Rocket(getParticleTexture(this.app), {
      x: clampedX,
      startY: height + 10,
      targetY: Math.max(apex, 20),
      color,
      forcedType,
      onComplete,
    });
    this.layer.addChild(rocket.sprite);
    this.rockets.push(rocket);
    this.onLaunch?.(clampedX);
  }

  update(delta: number): void {
    if (this.autoLaunchEnabled) {
      this.timeToNextAutoLaunch -= delta / 60;
      if (this.timeToNextAutoLaunch <= 0) {
        this.launch(Math.random() * this.app.screen.width);
        this.timeToNextAutoLaunch = this.randomLaunchDelay();
      }
    }

    this.rockets = this.rockets.filter((rocket) => {
      const reachedApex = rocket.update(delta, (x, y) => this.spawnTrailSpark(x, y, rocket.color));
      if (reachedApex) {
        this.explode(rocket.x, rocket.y, rocket.forcedType, rocket.onComplete);
        this.layer.removeChild(rocket.sprite);
        rocket.destroy();
        return false;
      }
      return true;
    });

    this.particles = this.particles.filter((particle) => {
      const alive = particle.update(delta);
      if (!alive) {
        particle.kill();
        this.particlePool.push(particle);
        this.resolveWatcher(particle);
      }
      return alive;
    });

    if (this.pendingSpawns.length > 0) {
      this.particles.push(...this.pendingSpawns);
      this.pendingSpawns = [];
    }

    if (this.fountains.length > 0) {
      this.fountains = this.fountains.filter((fountain) => {
        fountain.update(delta);
        if (fountain.finished) {
          fountain.destroy();
          return false;
        }
        return true;
      });
    }
  }

  /** Whether a tap should ignite a Ground Fountain instead of launching a rocket. */
  isGroundFountainMode(): boolean {
    return this.groundFountainModeEnabled;
  }

  setGroundFountainMode(enabled: boolean): void {
    this.groundFountainModeEnabled = enabled;
  }

  /** A continuous 5s narrow-cone spark stream from (x, y) — see GroundFountain. */
  igniteGroundFountain(x: number, y: number): void {
    this.fountains.push(new GroundFountain(this.app, x, y, this.layer));
  }

  setAutoLaunch(enabled: boolean): void {
    this.autoLaunchEnabled = enabled;
    if (enabled) this.timeToNextAutoLaunch = this.randomLaunchDelay();
  }

  /** Restricts random bursts (auto-launch and manual taps) to these shell types. Ignored while random mode is on. */
  setEnabledTypes(types: BurstType[]): void {
    this.enabledTypes = types.length > 0 ? types : [...ALL_BURST_TYPES];
  }

  /** 🎲 Smart Randomizer: every burst hybridizes 1-2 random patterns with perturbed density/lifespan/scale. */
  setRandomMode(enabled: boolean): void {
    this.randomModeEnabled = enabled;
  }

  /** The player's color-picker choice (see PlanningScreen's color panel): every rocket + burst from now on is dyed this hue. `null` restores the normal random palettes ("متعدد الألوان"). */
  setActiveColor(hex: number | null): void {
    this.activeColor = hex;
  }

  /**
   * A small, decorative sparkle burst at an arbitrary point — no rocket, no
   * shell/burst-pattern selection, not tracked by any onComplete batch.
   * Reuses the exact same Particle/pooling machinery as every real burst
   * (spawnParticle/addParticle), just with a smaller/shorter-lived spawn
   * loop. Used by CharacterReveal.ts for the "a letter has just settled
   * into its final position" moment.
   */
  spawnSettleSparkle(x: number, y: number, color?: number): void {
    const burstColor = color ?? this.activeColor ?? randomColor(randomPalette());
    const count = 16;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = (1.4 + Math.random() * 1.2) * this.settings.explosionScale;
      const particle = this.spawnParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: burstColor,
        size: (5 + Math.random() * 3) * this.glowSizeBoost(),
        life: (40 + Math.random() * 20) * this.settings.lifespanScale,
        gravity: 0.08 * this.settings.gravityScale,
        drag: 0.985,
      });
      this.addParticle(particle);
    }
  }

  /** Live-tunable physics/visuals; every subsequent burst reads the merged values. */
  updateSettings(partial: Partial<BurstSettings>): void {
    Object.assign(this.settings, partial);
    this.applyGlow();
  }

  /**
   * Instantly kills every in-flight rocket and live particle and resolves
   * any burst still being watched for completion — used by the exit flow
   * (see fireworksMood.ts's endShow()) so the sky is genuinely empty the
   * moment the player leaves, not fading out over the next several seconds.
   * Killed particles still go through the normal pool (`kill()` + push to
   * `particlePool`), so the next show reuses them exactly like an ordinary
   * natural death would.
   */
  clearActive(): void {
    for (const rocket of this.rockets) {
      this.layer.removeChild(rocket.sprite);
      rocket.destroy();
    }
    this.rockets = [];

    for (const particle of [...this.particles, ...this.pendingSpawns]) {
      particle.kill();
      this.particlePool.push(particle);
      this.resolveWatcher(particle);
    }
    this.particles = [];
    this.pendingSpawns = [];

    for (const fountain of this.fountains) fountain.destroy();
    this.fountains = [];
  }

  private applyGlow(): void {
    const strength = Math.max(this.settings.glow, 0); // slider range 0-10
    const normalized = Math.min(strength / 10, 1);
    // Tuned so the default slider position (2/10) already reads as a clear
    // bloom, not a barely-there one — matches roughly bloomScale 1.2/blur 8
    // at the default, scaling up to a stronger halo at the slider's max.
    this.glowFilter.bloomScale = 0.9 + normalized * 1.3;
    this.glowFilter.blur = 4 + normalized * 8;
    // colorFilter stays applied regardless of the glow slider — it's a
    // baseline saturation boost, not part of the glow effect itself.
    this.layer.filters = strength > 0.05 ? [this.glowFilter, this.colorFilter] : [this.colorFilter];
  }

  /** Every burst pattern constructs particles through here — reuses a dead pooled instance when one's available (see `particlePool`'s own doc comment), only ever allocating a fresh `Particle` on a genuine pool miss. Takes no `texture` argument: a pool miss's `new Particle(...)` always uses the one shared texture the pool's factory closed over in the constructor (see `particlePool`'s own initialization). */
  private spawnParticle(options: ParticleOptions): Particle {
    const particle = this.particlePool.pop();
    particle.init(options);
    return particle;
  }

  private addParticle(particle: Particle, batch?: BurstCompletion): void {
    this.pendingSpawns.push(particle);
    if (batch) {
      batch.remaining++;
      this.particleWatchers.set(particle, batch);
    }
  }

  private resolveWatcher(particle: Particle): void {
    const watcher = this.particleWatchers.get(particle);
    if (!watcher) return;
    this.particleWatchers.delete(particle);
    watcher.remaining--;
    if (watcher.remaining <= 0) watcher.onComplete();
  }

  /** Builds the `BurstContext` a pattern function (Peony.ts, Heart.ts, ...) runs against — see patterns/types.ts. */
  private buildContext(batch?: BurstCompletion): BurstContext {
    return {
      spawn: (options) => {
        const particle = this.spawnParticle(options);
        this.addParticle(particle, batch);
        return particle;
      },
      settings: this.settings,
      activeColor: this.activeColor,
      densityRatio: this.densityRatio(),
      glowSizeBoost: this.glowSizeBoost(),
      fillSpeed: (maxSpeed, minRatio) => this.fillSpeed(maxSpeed, minRatio),
    };
  }

  private explode(x: number, y: number, forcedType?: BurstType, onComplete?: () => void): void {
    const spawnedBefore = this.pendingSpawns.length;
    // Tracks this explosion's full lineage — including deferred children a
    // burst spawns later (Kamuro glitter, Crossette splits) — so onComplete
    // fires only once every last one of them has actually faded away.
    const batch: BurstCompletion | undefined = onComplete ? { remaining: 0, onComplete } : undefined;

    // Isolated, real wall-clock cost of the burst pattern's own synchronous
    // spawn loop — see `lastBurstSpawnMs`'s own doc comment.
    const startTime = performance.now();

    if (forcedType) {
      BURST_PATTERNS[forcedType](x, y, this.buildContext(batch));
    } else if (this.randomModeEnabled) {
      this.burstRandomHybrid(x, y);
    } else {
      const type = this.enabledTypes[Math.floor(Math.random() * this.enabledTypes.length)];
      BURST_PATTERNS[type](x, y, this.buildContext(batch));
    }

    this.lastBurstSpawnMs = performance.now() - startTime;

    // Defensive: if somehow nothing was spawned, don't leave onComplete hanging forever.
    if (batch && batch.remaining === 0) batch.onComplete();

    const spawnedCount = this.pendingSpawns.length - spawnedBefore;
    const intensity = spawnedCount / BURST_INTENSITY_REFERENCE_COUNT;
    this.onExplode?.(x, y, intensity);
  }

  /**
   * 🎲 Smart Randomizer: picks 1 or 2 patterns (merging them into one burst),
   * then perturbs density/lifespan/scale just for this explosion so every
   * click produces a genuinely different hybrid — the shared sliders are
   * restored immediately after.
   */
  private burstRandomHybrid(x: number, y: number): void {
    const layerCount = Math.random() < 0.55 ? 1 : 2;
    const chosenIndices = new Set<number>();
    while (chosenIndices.size < layerCount) {
      chosenIndices.add(Math.floor(Math.random() * ALL_BURST_TYPES.length));
    }

    const savedSettings = { ...this.settings };
    this.settings.particleDensity *= 0.65 + Math.random() * 0.9;
    this.settings.lifespanScale *= 0.7 + Math.random() * 0.9;
    this.settings.explosionScale *= 0.8 + Math.random() * 0.6;

    const ctx = this.buildContext();
    for (const index of chosenIndices) BURST_PATTERNS[ALL_BURST_TYPES[index]](x, y, ctx);

    this.settings = savedSettings;
  }

  private densityRatio(): number {
    return this.settings.particleDensity / DEFAULT_BURST_SETTINGS.particleDensity;
  }

  private glowSizeBoost(): number {
    return 1 + this.settings.glow * 0.05;
  }

  /**
   * A narrow, near-uniform speed range sends every spark to almost the same
   * radius at once — the "hollow ring" look. Sampling speed uniformly across
   * the FULL range from near-zero up to `maxSpeed` instead means a good
   * share of sparks are slow and settle deep inside the burst instead of
   * only ever living on its rim, filling the sphere with real depth. It also
   * naturally packs more sparks per unit area near the center (smaller
   * radii cover less area for the same particle count), which is exactly
   * where a real shell's brightest, hottest core sits.
   */
  private fillSpeed(maxSpeed: number, minRatio = 0.1): number {
    return maxSpeed * (minRatio + Math.random() * (1 - minRatio));
  }

  private spawnTrailSpark(x: number, y: number, color: number): void {
    this.addParticle(
      this.spawnParticle({
        x,
        y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.3 + Math.random() * 0.3,
        color,
        size: 4 + Math.random() * 3,
        life: 18 + Math.random() * 10,
        gravity: 0.02,
        drag: 0.97,
      }),
    );
  }

  private randomLaunchDelay(): number {
    return MIN_LAUNCH_INTERVAL + Math.random() * (MAX_LAUNCH_INTERVAL - MIN_LAUNCH_INTERVAL);
  }
}
