import type { Container, Text } from 'pixi.js';
import { Particle } from '../../fireworks/Particle';
import type { TextEffect, TextEffectContext } from './types';
import { clamp01, easeOutQuad, pick } from './utils';

const REVEAL_DURATION = 130;
const TEXT_FADE_START = 8;
const TEXT_FADE_END = 55;
const SPARK_COLORS = [0xfff6d0, 0xffe9b3, 0xffd700, 0xffffff];
const SPARK_COUNT = 70;

/**
 * "شرار متفجر" — a radial burst of bright sparks explodes outward from the
 * text's own center, like a firework going off right on top of it, while
 * the text itself flashes into view almost immediately (a quick reveal,
 * not a slow dissolve) as the burst disperses around it.
 */
export class SparkEffect implements TextEffect {
  private container!: Container;
  private text!: Text;
  private particles: Particle[] = [];
  private age = 0;
  private resolveFn: (() => void) | null = null;

  play(ctx: TextEffectContext): Promise<void> {
    this.container = ctx.container;
    this.text = ctx.text;
    this.text.alpha = 0;
    this.age = 0;

    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / SPARK_COUNT + Math.random() * 0.3;
      const speed = 1.5 + Math.random() * 2.2;
      const particle = new Particle(ctx.particleTexture, {
        x: this.text.x,
        y: this.text.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: pick(SPARK_COLORS),
        size: 6 + Math.random() * 8,
        life: 50 + Math.random() * 40,
        gravity: 0.05,
        drag: 0.96,
        twinkle: Math.random() < 0.5,
      });
      this.container.addChild(particle.sprite);
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
      if (!alive) {
        this.container.removeChild(particle.sprite);
        particle.destroy();
      }
      return alive;
    });

    if (this.age >= REVEAL_DURATION && this.resolveFn) {
      this.text.alpha = 1;
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  clear(): void {
    for (const particle of this.particles) {
      this.container.removeChild(particle.sprite);
      particle.destroy();
    }
    this.particles = [];
    this.resolveFn = null;
  }
}
