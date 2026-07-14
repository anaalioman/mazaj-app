import type { Container, Text } from 'pixi.js';
import { Text as PixiText } from 'pixi.js';
import type { TextEffect, TextEffectContext } from './types';
import { clamp01, pick } from './utils';

const NEON_COLORS = [0x39ffea, 0xff3df0, 0xfff23d, 0x39ff6a, 0x3d8bff];
const FLICKER_DURATION = 90; // frames of erratic on/off flicker
const SETTLE_DURATION = 40; // frames for the glow halo to fade out after settling
const SETTLED_TINT = 0xffe9b3; // matches the text's own gold fill, same as every other effect's resting look

/**
 * "وميض نيون ملون" — the text flickers on/off through a handful of vivid
 * neon colors like a sign powering on, backed by a soft additive glow
 * duplicate, then snaps to steady and fades the glow away.
 */
export class NeonEffect implements TextEffect {
  private container!: Container;
  private text!: Text;
  private glow!: Text;
  private age = 0;
  private nextFlipAt = 0;
  private settled = false;
  private resolveFn: (() => void) | null = null;

  play(ctx: TextEffectContext): Promise<void> {
    this.container = ctx.container;
    this.text = ctx.text;
    this.age = 0;
    this.nextFlipAt = 0;
    this.settled = false;

    this.glow = new PixiText({ text: this.text.text, style: this.text.style });
    this.glow.anchor.copyFrom(this.text.anchor);
    this.glow.position.copyFrom(this.text.position);
    this.glow.scale.set(1.15);
    this.glow.alpha = 0;
    this.glow.blendMode = 'add';
    const textIndex = this.container.getChildIndex(this.text);
    this.container.addChildAt(this.glow, textIndex);

    this.text.alpha = 0;

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  update(delta: number): void {
    this.age += delta;

    if (!this.settled) {
      if (this.age >= FLICKER_DURATION) {
        this.settled = true;
        this.text.tint = SETTLED_TINT;
        this.text.alpha = 1;
        this.glow.tint = SETTLED_TINT;
        this.glow.alpha = 0.4;
      } else if (this.age >= this.nextFlipAt) {
        const on = Math.random() < 0.72;
        const color = pick(NEON_COLORS);
        this.text.tint = color;
        this.text.alpha = on ? 1 : 0.08;
        this.glow.tint = color;
        this.glow.alpha = on ? 0.45 : 0.05;
        this.nextFlipAt = this.age + 2 + Math.random() * 6;
      }
      return;
    }

    const t = clamp01((this.age - FLICKER_DURATION) / SETTLE_DURATION);
    this.glow.alpha = 0.4 * (1 - t);

    if (this.age >= FLICKER_DURATION + SETTLE_DURATION && this.resolveFn) {
      this.glow.alpha = 0;
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  clear(): void {
    if (this.glow) {
      this.container.removeChild(this.glow);
      this.glow.destroy();
    }
    if (this.text) this.text.tint = SETTLED_TINT;
    // Settles an interrupted play() instead of leaving its promise hanging
    // forever — see dissolveCloud.ts's own doc comment on this same pattern.
    this.resolveFn?.();
    this.resolveFn = null;
  }
}
