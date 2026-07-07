import { Application, Container } from 'pixi.js';
import { Particle } from './Particle';
import { Rocket } from './Rocket';
import { getParticleTexture } from './textures';
import { randomColor, randomPalette } from './colors';

const MIN_LAUNCH_INTERVAL = 0.9;
const MAX_LAUNCH_INTERVAL = 2.4;

/**
 * Owns every rocket and spark on screen: spawning, physics, and cleanup.
 * `update()` is meant to be driven from the Pixi ticker each frame.
 */
export class FireworksSystem {
  private readonly app: Application;
  private readonly layer: Container;

  private rockets: Rocket[] = [];
  private particles: Particle[] = [];

  private autoLaunchEnabled: boolean;
  private timeToNextAutoLaunch: number;

  constructor(app: Application, options: { autoLaunch?: boolean } = {}) {
    this.app = app;
    this.layer = new Container();
    app.stage.addChild(this.layer);

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

    const rocket = new Rocket(getParticleTexture(this.app), {
      x: Math.min(Math.max(x, 20), width - 20),
      startY: height + 10,
      targetY: Math.max(apex, 20),
      color,
    });
    this.layer.addChild(rocket.sprite);
    this.rockets.push(rocket);
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
        this.explode(rocket.x, rocket.y, rocket.color);
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
  }

  setAutoLaunch(enabled: boolean): void {
    this.autoLaunchEnabled = enabled;
    if (enabled) this.timeToNextAutoLaunch = this.randomLaunchDelay();
  }

  private explode(x: number, y: number, seedColor: number): void {
    const palette = randomPalette();
    const count = 55 + Math.floor(Math.random() * 60);
    const baseSpeed = 2.4 + Math.random() * 2.2;
    const texture = getParticleTexture(this.app);

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = baseSpeed * (0.5 + Math.random() * 0.6);
      const color = Math.random() < 0.7 ? randomColor(palette) : seedColor;

      const particle = new Particle(texture, {
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
      });
      this.layer.addChild(particle.sprite);
      this.particles.push(particle);
    }
  }

  private spawnTrailSpark(x: number, y: number, color: number): void {
    const particle = new Particle(getParticleTexture(this.app), {
      x,
      y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.3 + Math.random() * 0.3,
      color,
      size: 4 + Math.random() * 3,
      life: 18 + Math.random() * 10,
      gravity: 0.02,
      drag: 0.97,
    });
    this.layer.addChild(particle.sprite);
    this.particles.push(particle);
  }

  private randomLaunchDelay(): number {
    return MIN_LAUNCH_INTERVAL + Math.random() * (MAX_LAUNCH_INTERVAL - MIN_LAUNCH_INTERVAL);
  }
}
