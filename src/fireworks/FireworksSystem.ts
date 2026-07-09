import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { Particle } from './Particle';
import { Rocket } from './Rocket';
import { GroundFountain } from './GroundFountain';
import { getParticleTexture } from './textures';
import { pickBurstColors, randomColor, randomPalette } from './colors';

const MIN_LAUNCH_INTERVAL = 0.9;
const MAX_LAUNCH_INTERVAL = 2.4;

const GOLD_HUES = [0xffd700, 0xffe9a8, 0xffc233, 0xfff4c2];

// Particles spawned by one explosion, relative to this, become its "shake
// intensity" — dense bursts (peony, rose, multi-ring) shake noticeably,
// thin ones (a handful of crossette arms) don't shake at all.
const BURST_INTENSITY_REFERENCE_COUNT = 150;

export type BurstType = 'peony' | 'rose' | 'kamuro' | 'crossette' | 'multiRing' | 'strobe';
export const ALL_BURST_TYPES: BurstType[] = ['peony', 'rose', 'kamuro', 'crossette', 'multiRing', 'strobe'];

export interface BurstSettings {
  /** Baseline particle count per burst (control panel: 50-500, default 150). */
  particleDensity: number;
  /** Multiplier on the downward pull applied to burst sparks. */
  gravityScale: number;
  /** Multiplier on how long fragments linger before fading. */
  lifespanScale: number;
  /** Multiplier on initial burst velocity / spread radius. */
  explosionScale: number;
  /** 0-10: trail thickness + a screen-space glow (blur) on the particle layer. */
  glow: number;
}

export const DEFAULT_BURST_SETTINGS: BurstSettings = {
  particleDensity: 150,
  gravityScale: 1,
  lifespanScale: 1,
  explosionScale: 1,
  glow: 2,
};

export interface FireworksSystemOptions {
  autoLaunch?: boolean;
  onLaunch?: (x: number) => void;
  /** `intensity` is roughly 0-1.5, scaled by how many particles the burst spawned. */
  onExplode?: (x: number, y: number, intensity: number) => void;
}

/** Picks a random palette guaranteed to differ from `exclude`, for real color contrast. */
function contrastingPalette(exclude: number[]): number[] {
  let palette = randomPalette();
  let guard = 0;
  while (palette === exclude && guard++ < 5) palette = randomPalette();
  return palette;
}

/**
 * Owns every rocket and spark on screen: spawning, physics, and cleanup.
 * `update()` is meant to be driven from the Pixi ticker each frame.
 */
export class FireworksSystem {
  private readonly app: Application;
  private readonly layer: Container;
  private readonly glowFilter: AdvancedBloomFilter;
  private readonly onLaunch?: (x: number) => void;
  private readonly onExplode?: (x: number, y: number, intensity: number) => void;

  private rockets: Rocket[] = [];
  private particles: Particle[] = [];
  // Particles spawned mid-tick (Kamuro glitter, Crossette splits) land here
  // first and get merged in once, after both filter passes below finish —
  // mutating `particles` while `Array.prototype.filter` is iterating it
  // would silently drop anything pushed past the loop's captured length.
  private pendingSpawns: Particle[] = [];

  private settings: BurstSettings = { ...DEFAULT_BURST_SETTINGS };
  private enabledTypes: BurstType[] = [...ALL_BURST_TYPES];
  private randomModeEnabled = false;

  private fountains: GroundFountain[] = [];
  private groundFountainModeEnabled = false;

  private autoLaunchEnabled: boolean;
  private timeToNextAutoLaunch: number;

  constructor(app: Application, options: FireworksSystemOptions = {}) {
    this.app = app;
    this.layer = new Container();
    app.stage.addChild(this.layer);
    this.onLaunch = options.onLaunch;
    this.onExplode = options.onExplode;

    // True bloom (bright-pass extract + blur + additive-style composite),
    // not a flat blur — only genuinely bright pixels (white-hot ignition,
    // hot embers) bleed light into the dark around them. `quality: 4` is a
    // deliberate mid-range-Android compromise (KawaseBlur's default is 4);
    // drop it further if a real device shows an FPS hit.
    this.glowFilter = new AdvancedBloomFilter({ threshold: 0.4, blur: 6, quality: 4, bloomScale: 1.2, brightness: 1 });
    this.applyGlow();

    // Force-build the shared particle texture up front so the first
    // firework doesn't stall on texture generation.
    getParticleTexture(app);

    this.autoLaunchEnabled = options.autoLaunch ?? true;
    this.timeToNextAutoLaunch = this.randomLaunchDelay();
  }

  /** Launches a shell toward (x, targetY). Defaults to a random apex height. */
  launch(x: number, targetY?: number): void {
    const { width, height } = this.app.screen;
    const apex = targetY ?? height * (0.15 + Math.random() * 0.45);
    const palette = randomPalette();
    const color = randomColor(palette);
    const clampedX = Math.min(Math.max(x, 20), width - 20);

    const rocket = new Rocket(getParticleTexture(this.app), {
      x: clampedX,
      startY: height + 10,
      targetY: Math.max(apex, 20),
      color,
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
        this.explode(rocket.x, rocket.y);
        this.layer.removeChild(rocket.sprite);
        rocket.destroy();
        return false;
      }
      return true;
    });

    this.particles = this.particles.filter((particle) => {
      const alive = particle.update(delta);
      if (!alive) {
        this.layer.removeChild(particle.sprite);
        particle.destroy();
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

  /** Live-tunable physics/visuals; every subsequent burst reads the merged values. */
  updateSettings(partial: Partial<BurstSettings>): void {
    Object.assign(this.settings, partial);
    this.applyGlow();
  }

  private applyGlow(): void {
    const strength = Math.max(this.settings.glow, 0); // slider range 0-10
    const normalized = Math.min(strength / 10, 1);
    // Tuned so the default slider position (2/10) already reads as a clear
    // bloom, not a barely-there one — matches roughly bloomScale 1.2/blur 8
    // at the default, scaling up to a stronger halo at the slider's max.
    this.glowFilter.bloomScale = 0.9 + normalized * 1.3;
    this.glowFilter.blur = 4 + normalized * 8;
    this.layer.filters = strength > 0.05 ? [this.glowFilter] : [];
  }

  private addParticle(particle: Particle): void {
    this.layer.addChild(particle.sprite);
    this.pendingSpawns.push(particle);
  }

  private explode(x: number, y: number): void {
    const spawnedBefore = this.pendingSpawns.length;

    if (this.randomModeEnabled) {
      this.burstRandomHybrid(x, y);
    } else {
      const type = this.enabledTypes[Math.floor(Math.random() * this.enabledTypes.length)];
      switch (type) {
        case 'rose':
          this.burstRose(x, y);
          break;
        case 'kamuro':
          this.burstKamuro(x, y);
          break;
        case 'crossette':
          this.burstPalmCrossette(x, y);
          break;
        case 'multiRing':
          this.burstMultiRing(x, y);
          break;
        case 'strobe':
          this.burstStrobe(x, y);
          break;
        default:
          this.burstPeony(x, y);
          break;
      }
    }

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
    const builders: Array<() => void> = [
      () => this.burstPeony(x, y),
      () => this.burstRose(x, y),
      () => this.burstKamuro(x, y),
      () => this.burstPalmCrossette(x, y),
      () => this.burstMultiRing(x, y),
      () => this.burstStrobe(x, y),
    ];

    const layerCount = Math.random() < 0.55 ? 1 : 2;
    const chosenIndices = new Set<number>();
    while (chosenIndices.size < layerCount) {
      chosenIndices.add(Math.floor(Math.random() * builders.length));
    }

    const savedSettings = { ...this.settings };
    this.settings.particleDensity *= 0.65 + Math.random() * 0.9;
    this.settings.lifespanScale *= 0.7 + Math.random() * 0.9;
    this.settings.explosionScale *= 0.8 + Math.random() * 0.6;

    for (const index of chosenIndices) builders[index]();

    this.settings = savedSettings;
  }

  private densityRatio(): number {
    return this.settings.particleDensity / DEFAULT_BURST_SETTINGS.particleDensity;
  }

  private glowSizeBoost(): number {
    return 1 + this.settings.glow * 0.05;
  }

  /**
   * Peony with Pistil Core: a dense outer sphere in one primary color, and a
   * smaller, slower inner sphere in a contrasting color exploding at the
   * same instant — the classic two-tone "flower with a center" look.
   */
  private burstPeony(x: number, y: number): void {
    const texture = getParticleTexture(this.app);
    const outerPalette = randomPalette();
    const primaryColor = randomColor(outerPalette);
    const pistilColor = randomColor(contrastingPalette(outerPalette));

    const outerCount = Math.max(8, Math.round((70 + Math.random() * 50) * this.densityRatio()));
    const outerSpeed = (2.6 + Math.random() * 2.0) * this.settings.explosionScale;

    for (let i = 0; i < outerCount; i++) {
      const angle = (Math.PI * 2 * i) / outerCount + Math.random() * 0.25;
      const speed = outerSpeed * (0.75 + Math.random() * 0.35);

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: primaryColor,
          size: (8 + Math.random() * 5) * this.glowSizeBoost(),
          life: (55 + Math.random() * 40) * this.settings.lifespanScale,
          gravity: 0.1 * this.settings.gravityScale,
          drag: 0.982,
          twinkle: Math.random() < 0.25,
        }),
      );
    }

    const pistilCount = Math.max(6, Math.round(outerCount * 0.4));
    const pistilSpeed = outerSpeed * 0.42;

    for (let i = 0; i < pistilCount; i++) {
      const angle = (Math.PI * 2 * i) / pistilCount + Math.random() * 0.4;
      const speed = pistilSpeed * (0.7 + Math.random() * 0.5);

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: pistilColor,
          size: (6 + Math.random() * 4) * this.glowSizeBoost(),
          life: (38 + Math.random() * 22) * this.settings.lifespanScale,
          gravity: 0.1 * this.settings.gravityScale,
          drag: 0.978,
          twinkle: Math.random() < 0.3,
        }),
      );
    }
  }

  /**
   * Polar rose burst: initial velocity follows r = cos(k*theta), so as
   * particles fly outward in straight lines the expanding pattern traces a
   * k-petaled rose curve (negative r flips through the origin, which is
   * exactly how the classic rose curve handles it).
   */
  private burstRose(x: number, y: number): void {
    const burstColors = pickBurstColors(3 + Math.floor(Math.random() * 3));
    const texture = getParticleTexture(this.app);
    const k = 2 + Math.floor(Math.random() * 5);
    const count = Math.max(20, Math.round(140 * this.densityRatio()));
    const baseSpeed = (3.4 + Math.random() * 1.6) * this.settings.explosionScale;

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      const r = Math.cos(k * theta);
      const speed = r * baseSpeed * (0.9 + Math.random() * 0.2);
      const color = burstColors[Math.floor(Math.random() * burstColors.length)];

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(theta) * speed,
          vy: Math.sin(theta) * speed,
          color,
          size: (7 + Math.random() * 5) * this.glowSizeBoost(),
          life: (60 + Math.random() * 40) * this.settings.lifespanScale,
          gravity: 0.08 * this.settings.gravityScale,
          drag: 0.978,
          twinkle: Math.random() < 0.25,
        }),
      );
    }
  }

  /**
   * Kamuro / Brocade Crown: a huge, dense shower of light, low-drag golden
   * stars that barely feel gravity and keep emitting glitter continuously,
   * so they hang and drift down together like an umbrella of falling gold.
   */
  private burstKamuro(x: number, y: number): void {
    const texture = getParticleTexture(this.app);
    const count = Math.max(20, Math.round((85 + Math.random() * 35) * this.densityRatio()));
    const baseSpeed = (1.8 + Math.random() * 1.0) * this.settings.explosionScale;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const speed = baseSpeed * (0.7 + Math.random() * 0.5);
      const color = GOLD_HUES[Math.floor(Math.random() * GOLD_HUES.length)];

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: (9 + Math.random() * 5) * this.glowSizeBoost(),
          life: (210 + Math.random() * 90) * this.settings.lifespanScale,
          gravity: 0.045 * this.settings.gravityScale, // light weight: barely falls
          drag: 0.994, // low air resistance: keeps drifting outward
          sparkleInterval: 3 + Math.random() * 2, // frequent glitter -> continuous trail
          onSparkle: (sx, sy) => this.spawnKamuroSparkle(sx, sy),
        }),
      );
    }
  }

  private spawnKamuroSparkle(x: number, y: number): void {
    const texture = getParticleTexture(this.app);
    const color = GOLD_HUES[Math.floor(Math.random() * GOLD_HUES.length)];

    this.addParticle(
      new Particle(texture, {
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.12 + Math.random() * 0.2,
        color,
        size: (2 + Math.random() * 2) * this.glowSizeBoost(),
        life: (26 + Math.random() * 22) * this.settings.lifespanScale,
        gravity: 0.035 * this.settings.gravityScale,
        drag: 0.975,
        twinkle: true,
      }),
    );
  }

  /**
   * Palm Tree Crossette: 5-7 thick arms fired from center like fronds; each
   * arm trails its own dust and, right at the end of its life, splits into
   * two sparks fired opposite each other (perpendicular to the arm) instead
   * of continuing straight.
   */
  private burstPalmCrossette(x: number, y: number): void {
    const burstColors = pickBurstColors(3);
    const texture = getParticleTexture(this.app);
    const armCount = 5 + Math.floor(Math.random() * 3); // 5, 6, or 7
    const baseSpeed = (3.0 + Math.random() * 1.4) * this.settings.explosionScale;

    for (let i = 0; i < armCount; i++) {
      const angle = (Math.PI * 2 * i) / armCount + (Math.random() - 0.5) * 0.15;
      const speed = baseSpeed * (0.85 + Math.random() * 0.3);
      const color = burstColors[Math.floor(Math.random() * burstColors.length)];
      const life = (55 + Math.random() * 20) * this.settings.lifespanScale;

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: (15 + Math.random() * 6) * this.glowSizeBoost(), // thick frond
          life,
          gravity: 0.09 * this.settings.gravityScale,
          drag: 0.99,
          sparkleInterval: 2 + Math.random() * 2,
          onSparkle: (sx, sy) => this.spawnPalmArmTrail(sx, sy, color),
          splitAt: life * 0.94, // right at the tip of the arm's life
          onSplit: (sx, sy, svx, svy) => this.spawnPalmSplit(sx, sy, svx, svy, color),
        }),
      );
    }
  }

  private spawnPalmArmTrail(x: number, y: number, color: number): void {
    this.addParticle(
      new Particle(getParticleTexture(this.app), {
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 0.3,
        vy: 0.1 + Math.random() * 0.2,
        color,
        size: 3 + Math.random() * 2,
        life: (16 + Math.random() * 10) * this.settings.lifespanScale,
        gravity: 0.03 * this.settings.gravityScale,
        drag: 0.97,
      }),
    );
  }

  private spawnPalmSplit(x: number, y: number, vx: number, vy: number, color: number): void {
    const texture = getParticleTexture(this.app);
    const baseAngle = Math.atan2(vy, vx);
    const speed = Math.max(Math.hypot(vx, vy) * 0.7, 1.6);

    // Two sparks perpendicular to the arm's own direction — 180° apart from
    // each other, i.e. genuinely opposite directions.
    for (const sign of [1, -1]) {
      const angle = baseAngle + (Math.PI / 2) * sign;
      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: (6 + Math.random() * 3) * this.glowSizeBoost(),
          life: (26 + Math.random() * 16) * this.settings.lifespanScale,
          gravity: 0.12 * this.settings.gravityScale,
          drag: 0.98,
          twinkle: true,
        }),
      );
    }
  }

  /**
   * Multi-Ring: two flat ellipses expanding from the same center at the
   * same instant — one squashed vertically ("horizontal" ring), one
   * squashed horizontally ("vertical" ring) — crossing each other to read
   * as two intersecting rings, entirely with 2D coordinates (x, y only).
   */
  private burstMultiRing(x: number, y: number): void {
    const texture = getParticleTexture(this.app);
    const paletteA = randomPalette();
    const colorA = randomColor(paletteA);
    const colorB = randomColor(contrastingPalette(paletteA));

    const count = Math.max(30, Math.round(80 * this.densityRatio()));
    const speed = (3.6 + Math.random() * 1.2) * this.settings.explosionScale;

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(theta) * speed,
          vy: Math.sin(theta) * speed * 0.32,
          color: colorA,
          size: (7 + Math.random() * 4) * this.glowSizeBoost(),
          life: (65 + Math.random() * 30) * this.settings.lifespanScale,
          gravity: 0.06 * this.settings.gravityScale,
          drag: 0.99,
          twinkle: Math.random() < 0.2,
        }),
      );
    }

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2;
      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(theta) * speed * 0.32,
          vy: Math.sin(theta) * speed,
          color: colorB,
          size: (7 + Math.random() * 4) * this.glowSizeBoost(),
          life: (65 + Math.random() * 30) * this.settings.lifespanScale,
          gravity: 0.06 * this.settings.gravityScale,
          drag: 0.99,
          twinkle: Math.random() < 0.2,
        }),
      );
    }
  }

  /**
   * Strobe / Glitter Shell: stars that randomly blink fully on/off (not a
   * smooth twinkle) at varying speeds as they fall, like sparkling diamond
   * fragments, before finally extinguishing.
   */
  private burstStrobe(x: number, y: number): void {
    const burstColors = pickBurstColors(4 + Math.floor(Math.random() * 2));
    const texture = getParticleTexture(this.app);
    const count = Math.max(10, Math.round((60 + Math.random() * 50) * this.densityRatio()));
    const baseSpeed = (2.6 + Math.random() * 2.0) * this.settings.explosionScale;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = baseSpeed * (0.5 + Math.random() * 0.7);
      const color = burstColors[Math.floor(Math.random() * burstColors.length)];

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: (6 + Math.random() * 4) * this.glowSizeBoost(),
          life: (90 + Math.random() * 70) * this.settings.lifespanScale,
          gravity: 0.11 * this.settings.gravityScale,
          drag: 0.988,
          strobe: true,
        }),
      );
    }
  }

  private spawnTrailSpark(x: number, y: number, color: number): void {
    this.addParticle(
      new Particle(getParticleTexture(this.app), {
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
