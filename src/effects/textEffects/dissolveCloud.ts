import { ParticleContainer } from 'pixi.js';
import type { Container, Text } from 'pixi.js';
import { Particle } from '../../fireworks/Particle';
import type { TextEffect, TextEffectContext } from './types';
import { clamp01, easeOutQuad, pick } from './utils';

const REVEAL_DURATION = 170; // ticker frames, ~2.8s at 60fps
const TEXT_FADE_START = 40;
const TEXT_FADE_END = 130;

/**
 * Shared engine behind "smoke"/"flame": the text starts invisible, a cloud
 * of colored particles billows around it (additive blend, soft round
 * texture — see Particle.ts), and the text fades back in as the cloud
 * disperses. Subclasses only supply the color palette.
 */
export abstract class DissolveCloudEffect implements TextEffect {
  protected abstract readonly colors: number[];

  private container!: Container;
  private text!: Text;
  // A fresh pair per play() — see SparkEffect's own doc comment for why.
  private trailsContainer!: ParticleContainer;
  private coresContainer!: ParticleContainer;
  private particles: Particle[] = [];
  private age = 0;
  private resolveFn: (() => void) | null = null;

  play(ctx: TextEffectContext): Promise<void> {
    this.container = ctx.container;
    this.text = ctx.text;
    this.text.alpha = 0;
    this.age = 0;

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

    const count = 90;
    const halfW = this.text.width / 2;
    const halfH = this.text.height / 2;

    for (let i = 0; i < count; i++) {
      const heightRatio = Math.random();
      const px = this.text.x + (Math.random() - 0.5) * halfW * 2.6;
      const py = this.text.y + halfH - heightRatio * this.text.height * 1.6;

      const particle = new Particle(ctx.particleTexture, this.trailsContainer, this.coresContainer, {
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.4,
        color: pick(this.colors),
        size: 26 + Math.random() * 30,
        life: 110 + Math.random() * 55,
        gravity: -0.01,
        drag: 0.992,
      });
      this.particles.push(particle);
    }

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  update(delta: number): void {
    this.age += delta;
    const t = clamp01((this.age - TEXT_FADE_START) / (TEXT_FADE_END - TEXT_FADE_START));
    this.text.alpha = easeOutQuad(t);

    this.particles = this.particles.filter((particle) => {
      const alive = particle.update(delta);
      if (!alive) particle.destroy();
      return alive;
    });

    if (this.age >= REVEAL_DURATION && this.resolveFn) {
      this.text.alpha = 1;
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  clear(): void {
    for (const particle of this.particles) particle.destroy();
    this.particles = [];
    this.resolveFn = null;
    this.trailsContainer?.destroy();
    this.coresContainer?.destroy();
  }
}
