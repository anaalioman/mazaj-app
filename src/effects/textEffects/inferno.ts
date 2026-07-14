import { ParticleContainer } from 'pixi.js';
import type { Container, Text, Texture } from 'pixi.js';
import { Particle } from '../../fireworks/Particle';
import type { TextEffect, TextEffectContext } from './types';
import { clamp01, easeOutQuad, pick } from './utils';

const REVEAL_DURATION = 190;
const TEXT_FADE_START = 50;
const TEXT_FADE_END = 150;
const EMBER_COLORS = [0xffcf3d, 0xff8a3c, 0xff5a1f];
const EMBER_INTERVAL = 4; // frames between continuous rising embers

/**
 * "اللهب المتطور" — a denser, more turbulent flame cloud than the plain
 * "لهب" effect, plus a continuous stream of small embers that keep rising
 * and sparking off the text for the whole reveal, like a living fire
 * rather than a single puff of flame.
 */
export class InfernoEffect implements TextEffect {
  private container!: Container;
  private text!: Text;
  private texture!: Texture;
  // A fresh pair per play() — see SparkEffect's own doc comment for why.
  private trailsContainer!: ParticleContainer;
  private coresContainer!: ParticleContainer;
  private particles: Particle[] = [];
  private age = 0;
  private emberAccumulator = 0;
  private resolveFn: (() => void) | null = null;

  play(ctx: TextEffectContext): Promise<void> {
    this.container = ctx.container;
    this.text = ctx.text;
    this.texture = ctx.particleTexture;
    this.text.alpha = 0;
    this.age = 0;
    this.emberAccumulator = 0;

    this.trailsContainer = new ParticleContainer({
      texture: ctx.particleTexture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: true, vertex: true, uvs: false, color: true },
    });
    this.coresContainer = new ParticleContainer({
      texture: ctx.particleTexture,
      blendMode: 'add',
      dynamicProperties: { position: true, rotation: false, vertex: true, uvs: false, color: true },
    });
    this.container.addChild(this.trailsContainer, this.coresContainer);

    const halfW = this.text.width / 2;
    const halfH = this.text.height / 2;
    const count = 110;

    for (let i = 0; i < count; i++) {
      const heightRatio = Math.random();
      const px = this.text.x + (Math.random() - 0.5) * halfW * 2.8;
      const py = this.text.y + halfH - heightRatio * this.text.height * 1.9;
      this.spawn(px, py, (Math.random() - 0.5) * 0.7, -0.5 - Math.random() * 0.7, 24 + Math.random() * 34, 90 + Math.random() * 60);
    }

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  private spawn(x: number, y: number, vx: number, vy: number, size: number, life: number): void {
    const particle = new Particle(this.texture, this.trailsContainer, this.coresContainer);
    particle.init({
      x,
      y,
      vx,
      vy,
      color: pick(EMBER_COLORS),
      size,
      life,
      gravity: -0.015,
      drag: 0.99,
      twinkle: Math.random() < 0.4,
    });
    this.particles.push(particle);
  }

  update(delta: number): void {
    this.age += delta;
    const t = clamp01((this.age - TEXT_FADE_START) / (TEXT_FADE_END - TEXT_FADE_START));
    this.text.alpha = easeOutQuad(t);

    if (this.age < REVEAL_DURATION) {
      this.emberAccumulator += delta;
      if (this.emberAccumulator >= EMBER_INTERVAL) {
        this.emberAccumulator = 0;
        const ex = this.text.x + (Math.random() - 0.5) * this.text.width;
        const ey = this.text.y + this.text.height * 0.4;
        this.spawn(ex, ey, (Math.random() - 0.5) * 0.3, -0.6 - Math.random() * 0.5, 8 + Math.random() * 10, 40 + Math.random() * 30);
      }
    }

    this.particles = this.particles.filter((particle) => {
      const alive = particle.update(delta);
      if (!alive) particle.kill();
      return alive;
    });

    if (this.age >= REVEAL_DURATION && this.resolveFn) {
      this.text.alpha = 1;
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  clear(): void {
    for (const particle of this.particles) particle.kill();
    this.particles = [];
    this.resolveFn = null;
    this.trailsContainer?.destroy();
    this.coresContainer?.destroy();
  }
}
