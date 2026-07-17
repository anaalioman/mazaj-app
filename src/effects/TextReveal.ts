import { Application, Container, Text, TextStyle } from 'pixi.js';
import { getParticleTexture } from '../fireworks/textures';
import { createTextEffect, type TextEffect, type TextRevealEffect } from './textEffects/registry';

export type { TextRevealEffect };

export interface RevealOptions {
  /** Which effect module clears/plays to reveal the text (see src/effects/textEffects/registry.ts). Default 'smoke'. */
  effect?: TextRevealEffect;
  /** Stage-space (== screen CSS pixels in this app) position of the text's center. Defaults to top-center. */
  x?: number;
  y?: number;
  /** Multiplies the auto-computed base font size — matches whatever scale the player picked in the text composer's control box. Default 1. */
  fontScale?: number;
  /** Radians — matches whatever tilt the player set via the control box's rotate handle. Default 0 (upright). */
  rotation?: number;
}

/**
 * Reveals a phrase using whichever TextEffect module the caller picks (see
 * src/effects/textEffects/), then leaves the text fixed on screen for the
 * rest of the show. Drive it from the ticker via `update()`; `reveal()`
 * resolves once the text is fully visible. This class only owns the text
 * sprite's creation/positioning and the container everything renders into —
 * all the actual per-effect animation logic lives in its own module.
 */
export class TextReveal {
  private readonly app: Application;
  readonly container: Container;

  private textSprite: Text | null = null;
  private activeEffect: TextEffect | null = null;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
    app.stage.addChild(this.container);
  }

  reveal(phrase: string, options: RevealOptions = {}): Promise<void> {
    const trimmed = phrase.trim();
    if (!trimmed) return Promise.resolve();

    this.clear();

    const { width, height } = this.app.screen;
    const effectId = options.effect ?? 'smoke';
    const x = options.x ?? width / 2;
    const y = options.y ?? height * 0.28;
    const fontScale = options.fontScale ?? 1;

    const style = new TextStyle({
      fontFamily: 'Tajawal, system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(Math.max(36, Math.min(width, height) * 0.09) * fontScale),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });

    const text = new Text({ text: trimmed, style });
    text.anchor.set(0.5);
    text.position.set(x, y);
    text.rotation = options.rotation ?? 0;
    this.container.addChild(text);
    this.textSprite = text;

    const effect = createTextEffect(effectId);
    this.activeEffect = effect;

    const promise = effect.play({ container: this.container, text, particleTexture: getParticleTexture(this.app) });
    void promise.then(() => {
      // Stop ticking a finished effect — matches how it always behaved before
      // this got pluggable. Also force-clears it (not just drops the
      // reference): an effect resolves once its own *overall* timer expires,
      // which for a module that keeps spawning new particles for its whole
      // duration (e.g. inferno.ts's continuous embers) does not guarantee
      // every individual particle's own shorter life has also expired yet.
      // Left alone, update() simply stops being called on this effect the
      // instant we drop it below — any still-alive particle freezes exactly
      // where it was, forever, since nothing else will ever call kill() on
      // it. clear() is idempotent and safe to call on an effect that's
      // already fully finished (empty particle list, already-destroyed
      // containers) — it's still correct, just a no-op in that case.
      if (this.activeEffect === effect) {
        effect.clear();
        this.activeEffect = null;
      }
    });
    return promise;
  }

  /** Removes whatever text/effect this instance currently has, so it can safely reveal() again — used by looping demo previews (see TextComposer). */
  clear(): void {
    this.activeEffect?.clear();
    this.activeEffect = null;
    if (this.textSprite) {
      this.container.removeChild(this.textSprite);
      this.textSprite.destroy();
      this.textSprite = null;
    }
  }

  update(delta: number): void {
    this.activeEffect?.update(delta);
  }
}
