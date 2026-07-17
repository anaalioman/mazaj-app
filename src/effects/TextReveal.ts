import { Application, BlurFilter, Container, Text, TextStyle } from 'pixi.js';
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
  /**
   * "سحابة دخان ذهبية" from the text composer's mode row — see
   * TextComposer.ts's own doc comment on this field for why it only ever
   * plays here, on the real reveal's settled text, never on the composer's
   * own idle preview. Default false.
   */
  smokeCloud?: boolean;
}

/** Slow upward drift, px per ticker.deltaTime unit (~px/frame at 60fps) — same tuned value already approved for the composer's earlier (now-removed) previewText version. */
const SMOKE_DRIFT_SPEED = 0.14;
/** Screen-space y the drifting text's own top edge clamps against — stays here forever once reached, per the explicit "must never disappear" requirement. */
const SMOKE_TOP_MARGIN = 28;
const SMOKE_BLUR_MIN = 1.5;
const SMOKE_BLUR_MAX = 4.5;
const SMOKE_BLUR_PULSE_SPEED = 0.015;

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

  /** See RevealOptions.smokeCloud's own doc comment. Only ever animates once `activeEffect` has finished — see update(). */
  private smokeCloudActive = false;
  private smokeElapsed = 0;
  private smokeDriftY = 0;
  private smokeBaseY = 0;
  private readonly smokeBlur: BlurFilter;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
    app.stage.addChild(this.container);
    this.smokeBlur = new BlurFilter({ strength: SMOKE_BLUR_MIN, quality: 3 });
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

    this.smokeCloudActive = options.smokeCloud ?? false;
    this.smokeElapsed = 0;
    this.smokeDriftY = 0;
    this.smokeBaseY = y;

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
    this.smokeCloudActive = false;
    this.smokeElapsed = 0;
    this.smokeDriftY = 0;
  }

  update(delta: number): void {
    this.activeEffect?.update(delta);
    if (this.smokeCloudActive && this.textSprite && !this.activeEffect) {
      this.syncSmokeCloud(delta);
    }
  }

  /**
   * Runs only once the reveal's own effect (smoke/flame/none/...) has fully
   * settled — this never fights with that effect's own transient animation,
   * it only ever takes over once the text is otherwise done moving. Same
   * clamp-not-fade design already proven correct on the composer's earlier
   * previewText version: drift stops dead once the text's own top edge
   * reaches SMOKE_TOP_MARGIN, staying there — fully visible — forever.
   */
  private syncSmokeCloud(delta: number): void {
    const text = this.textSprite;
    if (!text) return;
    this.smokeElapsed += delta;
    const minDriftY = this.smokeBaseY - text.height / 2 - SMOKE_TOP_MARGIN;
    this.smokeDriftY = Math.min(this.smokeDriftY + SMOKE_DRIFT_SPEED * delta, minDriftY);
    text.position.y = this.smokeBaseY - this.smokeDriftY;

    const pulse = (Math.sin(this.smokeElapsed * SMOKE_BLUR_PULSE_SPEED) + 1) / 2;
    this.smokeBlur.strength = SMOKE_BLUR_MIN + pulse * (SMOKE_BLUR_MAX - SMOKE_BLUR_MIN);
    text.filters = [this.smokeBlur];
  }
}
