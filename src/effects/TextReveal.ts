import { Application, BlurFilter, Container, TextStyle } from 'pixi.js';
import type { FireworksSystem } from '../fireworks/FireworksSystem';
import { CharacterReveal } from './CharacterReveal';
import { fastSin, TWO_PI } from '../fireworks/SineTable';

export interface RevealOptions {
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

/** Slow upward drift, px per ticker.deltaTime unit (~px/frame at 60fps) — same tuned value already approved for the composer's earlier previewText version. */
const SMOKE_DRIFT_SPEED = 0.14;
/** Screen-space y the drifting text's own top edge clamps against — stays here forever once reached, per the explicit "must never disappear" requirement. */
const SMOKE_TOP_MARGIN = 28;
const SMOKE_BLUR_MIN = 1.5;
const SMOKE_BLUR_MAX = 4.5;
const SMOKE_BLUR_PULSE_SPEED = 0.015;

/**
 * Reveals a phrase via `CharacterReveal` — one firework rocket per letter,
 * each settling its own sliced glyph into place — the sole reveal path (see
 * CharacterReveal.ts's own doc comment on why splitting Arabic *text* per
 * character would break glyph joining, and why slicing the one correctly-
 * shaped *texture* instead avoids that). Once every letter has settled the
 * text stays fixed on screen for the rest of the show, optionally drifting
 * upward under a golden smoke-cloud blur — see syncSmokeCloud(). Drive it
 * from the ticker via `update()`; `reveal()` resolves once every letter has
 * settled.
 */
export class TextReveal {
  private readonly app: Application;
  private readonly fireworks: FireworksSystem;
  readonly container: Container;

  private characterReveal: CharacterReveal | null = null;
  /** True once every letter has settled into place — see reveal()'s own promise chain. Smoke-cloud drift/blur only ever runs after this, so it never fights the launch/settle sequence's own motion. */
  private settled = false;

  private smokeCloudActive = false;
  /** Radians in `[0, TWO_PI)` for the smoke blur's breathing pulse — incrementally advanced/wrapped each frame in syncSmokeCloud() (runs for the rest of the show once triggered, so this must wrap rather than grow unboundedly), read through `fastSin()` instead of a live `Math.sin()`. */
  private smokeElapsed = 0;
  private smokeDriftY = 0;
  /** The settled text block's own top edge (stage space), captured once from `container.getBounds()` right as it settles — the clamp boundary syncSmokeCloud() drifts toward. */
  private smokeBaseTopY = 0;
  private readonly smokeBlur: BlurFilter;

  constructor(app: Application, worldContainer: Container, fireworks: FireworksSystem) {
    this.app = app;
    this.fireworks = fireworks;
    this.container = new Container();
    worldContainer.addChild(this.container);
    this.smokeBlur = new BlurFilter({ strength: SMOKE_BLUR_MIN, quality: 3 });
  }

  reveal(phrase: string, options: RevealOptions = {}): Promise<void> {
    const trimmed = phrase.trim();
    if (!trimmed) return Promise.resolve();

    this.clear();

    const { width, height } = this.app.screen;
    const x = options.x ?? width / 2;
    const y = options.y ?? height * 0.28;
    const fontScale = options.fontScale ?? 1;
    const rotation = options.rotation ?? 0;

    // Deliberately plain (no stroke/drop-shadow) — see CharacterReveal.ts's
    // own doc comment on why that would throw off its slice-width
    // measurements. A real, known visual tradeoff versus the composer's own
    // idle-preview style (which does carry a stroke/shadow): accepted here
    // for correct per-letter slicing, not an oversight.
    const style = new TextStyle({
      fontFamily: 'Tajawal, system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(Math.max(36, Math.min(width, height) * 0.09) * fontScale),
      fontWeight: '800',
      fill: 0xffe9b3,
    });

    this.smokeCloudActive = options.smokeCloud ?? false;
    this.smokeElapsed = 0;
    this.smokeDriftY = 0;
    this.settled = false;
    this.container.position.set(0, 0);
    this.container.filters = null;

    this.characterReveal = new CharacterReveal(this.app, this.container, this.fireworks);
    const promise = this.characterReveal.play({ text: trimmed, x, y, style, rotation });
    void promise.then(() => {
      this.settled = true;
      this.smokeBaseTopY = this.container.getBounds().y;
    });
    return promise;
  }

  /** Removes whatever's currently revealed so it can safely reveal() again. */
  clear(): void {
    this.characterReveal?.destroy();
    this.characterReveal = null;
    this.settled = false;
    this.smokeCloudActive = false;
    this.smokeElapsed = 0;
    this.smokeDriftY = 0;
    this.container.position.set(0, 0);
    this.container.filters = null;
  }

  update(delta: number): void {
    if (this.smokeCloudActive && this.settled) {
      this.syncSmokeCloud(delta);
    }
  }

  /**
   * Runs only once every letter has settled — never fights the launch/settle
   * sequence's own motion. Same clamp-not-fade design already proven correct
   * on the composer's earlier previewText version: drift stops dead once the
   * settled block's own top edge reaches SMOKE_TOP_MARGIN, staying there —
   * fully visible — forever. Applied to `container` as a whole (every
   * letter's sprite together, as one rigid group) rather than per-sprite,
   * since CharacterReveal settles N independent sprites, not one Text.
   */
  private syncSmokeCloud(delta: number): void {
    this.smokeElapsed += delta * SMOKE_BLUR_PULSE_SPEED;
    if (this.smokeElapsed >= TWO_PI) this.smokeElapsed -= TWO_PI;
    const minDriftY = this.smokeBaseTopY - SMOKE_TOP_MARGIN;
    this.smokeDriftY = Math.min(this.smokeDriftY + SMOKE_DRIFT_SPEED * delta, minDriftY);
    this.container.position.y = -this.smokeDriftY;

    const pulse = (fastSin(this.smokeElapsed) + 1) / 2;
    this.smokeBlur.strength = SMOKE_BLUR_MIN + pulse * (SMOKE_BLUR_MAX - SMOKE_BLUR_MIN);
    this.container.filters = [this.smokeBlur];
  }
}
