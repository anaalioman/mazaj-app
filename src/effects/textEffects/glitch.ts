import type { Container, Text } from 'pixi.js';
import { Text as PixiText } from 'pixi.js';
import type { TextEffect, TextEffectContext } from './types';

const GLITCH_DURATION = 100; // frames of erratic RGB-split jitter
const SETTLE_FADE_SPEED = 0.05; // per-frame alpha decay for the ghost copies once settling
const RGB_OFFSET = 4; // px

/**
 * "خلل رقمي" — two color-fringed ghost copies (red/cyan) of the text jitter
 * side to side with occasional bigger jump-cuts, like a corrupted video
 * signal, then settle into perfect alignment as a single clean text.
 */
export class GlitchEffect implements TextEffect {
  private container!: Container;
  private text!: Text;
  private redGhost!: Text;
  private cyanGhost!: Text;
  private age = 0;
  private resolveFn: (() => void) | null = null;

  play(ctx: TextEffectContext): Promise<void> {
    this.container = ctx.container;
    this.text = ctx.text;
    this.age = 0;
    this.text.alpha = 1;

    this.redGhost = new PixiText({ text: this.text.text, style: this.text.style });
    this.cyanGhost = new PixiText({ text: this.text.text, style: this.text.style });
    for (const ghost of [this.redGhost, this.cyanGhost]) {
      ghost.anchor.copyFrom(this.text.anchor);
      ghost.position.copyFrom(this.text.position);
      ghost.blendMode = 'add';
      ghost.alpha = 0.65;
    }
    this.redGhost.tint = 0xff2d55;
    this.cyanGhost.tint = 0x38e8ff;
    this.container.addChild(this.redGhost);
    this.container.addChild(this.cyanGhost);

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  update(delta: number): void {
    this.age += delta;

    if (this.age < GLITCH_DURATION) {
      const bigJump = Math.random() < 0.08;
      const offset = bigJump ? RGB_OFFSET * 3 : RGB_OFFSET;
      const jittering = Math.random() < 0.8;
      this.redGhost.position.x = this.text.x - (jittering ? offset * Math.random() : 0);
      this.cyanGhost.position.x = this.text.x + (jittering ? offset * Math.random() : 0);
      this.redGhost.visible = Math.random() < 0.9;
      this.cyanGhost.visible = Math.random() < 0.9;
      this.text.alpha = Math.random() < 0.85 ? 1 : 0.2;
      return;
    }

    // Settling: snap the real text to fully visible and fade the ghosts out.
    this.text.alpha = 1;
    this.redGhost.visible = true;
    this.cyanGhost.visible = true;
    this.redGhost.position.x = this.text.x;
    this.cyanGhost.position.x = this.text.x;
    this.redGhost.alpha = Math.max(0, this.redGhost.alpha - delta * SETTLE_FADE_SPEED);
    this.cyanGhost.alpha = Math.max(0, this.cyanGhost.alpha - delta * SETTLE_FADE_SPEED);

    if (this.redGhost.alpha <= 0 && this.cyanGhost.alpha <= 0 && this.resolveFn) {
      this.redGhost.visible = false;
      this.cyanGhost.visible = false;
      this.resolveFn();
      this.resolveFn = null;
    }
  }

  clear(): void {
    if (this.redGhost) {
      this.container.removeChild(this.redGhost);
      this.redGhost.destroy();
    }
    if (this.cyanGhost) {
      this.container.removeChild(this.cyanGhost);
      this.cyanGhost.destroy();
    }
    if (this.text) this.text.alpha = 1;
    // Settles an interrupted play() instead of leaving its promise hanging
    // forever — see dissolveCloud.ts's own doc comment on this same pattern.
    this.resolveFn?.();
    this.resolveFn = null;
  }
}
