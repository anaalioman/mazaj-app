import { Application, Container } from 'pixi.js';
import { Particle } from './Particle';
import { Rocket } from './Rocket';
import { getParticleTexture } from './textures';
import { pickBurstColors, randomColor, randomPalette } from './colors';

const MIN_LAUNCH_INTERVAL = 0.9;
const MAX_LAUNCH_INTERVAL = 2.4;

const GOLD_HUES = [0xffd700, 0xffe9a8, 0xffc233, 0xfff4c2];

type BurstType = 'peony' | 'rose' | 'kamuro' | 'crossette';

export interface FireworksSystemOptions {
  autoLaunch?: boolean;
  onLaunch?: (x: number) => void;
  onExplode?: (x: number, y: number) => void;
}

/**
 * Owns every rocket and spark on screen: spawning, physics, and cleanup.
 * `update()` is meant to be driven from the Pixi ticker each frame.
 */
export class FireworksSystem {
  private readonly app: Application;
  private readonly layer: Container;
  private readonly onLaunch?: (x: number) => void;
  private readonly onExplode?: (x: number, y: number) => void;

  private rockets: Rocket[] = [];
  private particles: Particle[] = [];
  // Particles spawned mid-tick (Kamuro glitter, Crossette splits) land here
  // first and get merged in once, after both filter passes below finish —
  // mutating `particles` while `Array.prototype.filter` is iterating it
  // would silently drop anything pushed past the loop's captured length.
  private pendingSpawns: Particle[] = [];

  private autoLaunchEnabled: boolean;
  private timeToNextAutoLaunch: number;

  constructor(app: Application, options: FireworksSystemOptions = {}) {
    this.app = app;
    this.layer = new Container();
    app.stage.addChild(this.layer);
    this.onLaunch = options.onLaunch;
    this.onExplode = options.onExplode;

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
        this.onExplode?.(rocket.x, rocket.y);
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
  }

  setAutoLaunch(enabled: boolean): void {
    this.autoLaunchEnabled = enabled;
    if (enabled) this.timeToNextAutoLaunch = this.randomLaunchDelay();
  }

  private addParticle(particle: Particle): void {
    this.layer.addChild(particle.sprite);
    this.pendingSpawns.push(particle);
  }

  private explode(x: number, y: number): void {
    switch (this.pickBurstType()) {
      case 'rose':
        this.burstRose(x, y);
        break;
      case 'kamuro':
        this.burstKamuro(x, y);
        break;
      case 'crossette':
        this.burstCrossette(x, y);
        break;
      default:
        this.burstPeony(x, y);
        break;
    }
  }

  private pickBurstType(): BurstType {
    const roll = Math.random();
    if (roll < 0.4) return 'peony';
    if (roll < 0.62) return 'rose';
    if (roll < 0.81) return 'kamuro';
    return 'crossette';
  }

  /** Classic radial chrysanthemum burst: even angles, random multi-color. */
  private burstPeony(x: number, y: number): void {
    const burstColors = pickBurstColors(4 + Math.floor(Math.random() * 3));
    const count = 55 + Math.floor(Math.random() * 60);
    const baseSpeed = 2.4 + Math.random() * 2.2;
    const texture = getParticleTexture(this.app);

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = baseSpeed * (0.5 + Math.random() * 0.6);
      const color = burstColors[Math.floor(Math.random() * burstColors.length)];

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: 8 + Math.random() * 6,
          life: 55 + Math.random() * 45,
          gravity: 0.1,
          drag: 0.982,
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
    const count = 140;
    const baseSpeed = 3.4 + Math.random() * 1.6;

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
          size: 7 + Math.random() * 5,
          life: 60 + Math.random() * 40,
          gravity: 0.08,
          drag: 0.978,
          twinkle: Math.random() < 0.25,
        }),
      );
    }
  }

  /**
   * Kamuro burst: slow, long-lived golden stars that each continuously emit
   * tiny falling glitter, producing the signature "golden willow" trails.
   */
  private burstKamuro(x: number, y: number): void {
    const texture = getParticleTexture(this.app);
    const count = 46 + Math.floor(Math.random() * 20);
    const baseSpeed = 2.0 + Math.random() * 1.2;

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
          size: 9 + Math.random() * 5,
          life: 150 + Math.random() * 60,
          gravity: 0.14,
          drag: 0.99,
          sparkleInterval: 4 + Math.random() * 3,
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
        vy: 0.15 + Math.random() * 0.25,
        color,
        size: 2 + Math.random() * 2,
        life: 20 + Math.random() * 18,
        gravity: 0.05,
        drag: 0.96,
        twinkle: true,
      }),
    );
  }

  /**
   * Crossette burst: normal stars that, partway through their flight, hand
   * off to four children fired in a plus-shaped cross around the split point.
   */
  private burstCrossette(x: number, y: number): void {
    const burstColors = pickBurstColors(3 + Math.floor(Math.random() * 2));
    const texture = getParticleTexture(this.app);
    const count = 26 + Math.floor(Math.random() * 10);
    const baseSpeed = 2.6 + Math.random() * 1.8;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = baseSpeed * (0.7 + Math.random() * 0.4);
      const color = burstColors[Math.floor(Math.random() * burstColors.length)];
      const life = 50 + Math.random() * 20;

      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: 8 + Math.random() * 5,
          life,
          gravity: 0.1,
          drag: 0.985,
          splitAt: life * (0.45 + Math.random() * 0.15),
          onSplit: (sx, sy, svx, svy) => this.spawnCrossChildren(sx, sy, svx, svy, color),
        }),
      );
    }
  }

  private spawnCrossChildren(x: number, y: number, vx: number, vy: number, color: number): void {
    const texture = getParticleTexture(this.app);
    const baseAngle = Math.atan2(vy, vx);
    const speed = Math.max(Math.hypot(vx, vy) * 0.8, 1.5);

    for (let i = 0; i < 4; i++) {
      const angle = baseAngle + (Math.PI / 2) * i;
      this.addParticle(
        new Particle(texture, {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: 5 + Math.random() * 3,
          life: 30 + Math.random() * 20,
          gravity: 0.12,
          drag: 0.98,
          twinkle: true,
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
