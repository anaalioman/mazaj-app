import { Application, Container, Text, TextStyle } from 'pixi.js';
import { Particle } from '../fireworks/Particle';
import { getParticleTexture } from '../fireworks/textures';

const REVEAL_DURATION = 170; // ticker frames, ~2.8s at 60fps
const TEXT_FADE_START = 40;
const TEXT_FADE_END = 130;

const FLAME_COLORS = [0xff7a3c, 0xffb04c, 0xff5a3c];
const SMOKE_COLORS = [0xbfbfbf, 0x9a9a9a, 0xe0e0e0];

function pick(colors: number[]): number {
  return colors[Math.floor(Math.random() * colors.length)];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Reveals a phrase through a dissolving smoke/flame cloud, then leaves the
 * text fixed on screen for the rest of the show. Drive it from the ticker
 * via `update()`; `reveal()` resolves once the text is fully visible.
 */
export class TextReveal {
  private readonly app: Application;
  readonly container: Container;

  private smoke: Particle[] = [];
  private textSprite: Text | null = null;
  private age = 0;
  private active = false;
  private resolveFn: (() => void) | null = null;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
    app.stage.addChild(this.container);
  }

  reveal(phrase: string): Promise<void> {
    const trimmed = phrase.trim();
    if (!trimmed) return Promise.resolve();

    const { width, height } = this.app.screen;
    const style = new TextStyle({
      fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(Math.max(36, Math.min(width, height) * 0.09)),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });

    const text = new Text({ text: trimmed, style });
    text.anchor.set(0.5);
    text.position.set(width / 2, height * 0.28);
    text.alpha = 0;
    this.container.addChild(text);
    this.textSprite = text;

    this.spawnSmoke(text);

    this.age = 0;
    this.active = true;
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  update(delta: number): void {
    if (!this.active) return;
    this.age += delta;

    if (this.textSprite) {
      const t = clamp01((this.age - TEXT_FADE_START) / (TEXT_FADE_END - TEXT_FADE_START));
      this.textSprite.alpha = easeOutQuad(t);
    }

    this.smoke = this.smoke.filter((particle) => {
      const alive = particle.update(delta);
      if (!alive) {
        this.container.removeChild(particle.sprite);
        particle.destroy();
      }
      return alive;
    });

    if (this.age >= REVEAL_DURATION) {
      this.active = false;
      if (this.textSprite) this.textSprite.alpha = 1;
      this.resolveFn?.();
      this.resolveFn = null;
    }
  }

  private spawnSmoke(text: Text): void {
    const texture = getParticleTexture(this.app);
    const count = 90;
    const halfW = text.width / 2;
    const halfH = text.height / 2;

    for (let i = 0; i < count; i++) {
      const heightRatio = Math.random();
      const px = text.x + (Math.random() - 0.5) * halfW * 2.6;
      const py = text.y + halfH - heightRatio * text.height * 1.6;
      const color = heightRatio < 0.4 ? pick(FLAME_COLORS) : pick(SMOKE_COLORS);

      const particle = new Particle(texture, {
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.4,
        color,
        size: 26 + Math.random() * 30,
        life: 110 + Math.random() * 55,
        gravity: -0.01,
        drag: 0.992,
      });
      this.container.addChild(particle.sprite);
      this.smoke.push(particle);
    }
  }
}
