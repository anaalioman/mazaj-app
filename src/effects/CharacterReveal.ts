import { CanvasTextMetrics, Container, Rectangle, Sprite, Text, TextStyle, Texture, type Application, type Ticker } from 'pixi.js';
import type { FireworksSystem } from '../fireworks/FireworksSystem';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';

export interface CharacterRevealOptions {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  /** Radians, same convention as Pixi's own `rotation` — rotates the whole revealed line as a rigid body around (x, y). Default 0 (upright). */
  rotation?: number;
}

interface CharacterSlice {
  sprite: Sprite;
  targetX: number;
  targetY: number;
}

const LAUNCH_STAGGER_MS = 220;
const SETTLE_MOVE_MS = 420;
const LAUNCH_SPREAD_PX = 90;

/**
 * "تقطيع النسيج" (texture slicing): the word is rendered exactly *once* as
 * a single genuine Pixi `Text` — the only place Arabic's contextual glyph
 * shaping (each letter's isolated/initial/medial/final form, and the
 * ligature joins between them) actually happens. Splitting the *source
 * string* into N independent `Text` objects (one per character) would
 * shape each one in isolation and break every join — so instead this
 * slices the one correctly-shaped *texture* into N `Sprite`s, each a
 * `frame` view into the same shared base texture (the identical technique
 * a sprite sheet uses). Every sprite still shows genuinely joined Arabic
 * glyphs; only the invisible rectangle each one crops is what's "split".
 *
 * Slice boundaries come from measuring cumulative prefix widths with
 * Pixi's own `CanvasTextMetrics.measureText()` (see measurePrefixWidths()
 * below) — the same static measurer `Text` itself uses internally for
 * word-wrap layout — not from a hand-rolled scratch canvas, and not from
 * Pixi's `Text` object directly, which has no public per-glyph API. For a
 * pure-RTL string, the *first* logical character ends up at the *right*
 * edge of the rendered box and each later character shifts further left
 * (this is how Arabic reads, right-to-left) — so a naive `prefixWidth[i]`
 * as a left-edge offset is backwards; see the `sliceLeft` calculation in
 * play() below for the correction.
 * Known, accepted approximation: measuring a prefix substring in
 * isolation can shape its own *last* character slightly differently than
 * it would be shaped mid-run in the full string (a joining-form edge
 * case) — a few-pixel-level cosmetic difference, not a correctness bug.
 *
 * Deliberately plain (no stroke/drop-shadow) style for this pass: Pixi's
 * Text canvas adds internal padding to fit a stroke/shadow's own extra
 * pixels, which would offset every glyph from what a stroke-less
 * measurement predicts. Keeping the sliced text unstyled avoids that whole
 * class of error; a per-sprite filter pass for the gold stroke/shadow look
 * is a real, separate follow-up once this core mechanism is confirmed
 * correct on a real device.
 *
 * Timing: every sequencing step in this class — the per-character launch
 * stagger and the settle-ease animation — runs off `this.app.ticker`
 * (see tickerSetTimeout in utils/tickerTimers.ts), not `window.setTimeout`
 * or `requestAnimationFrame`. Frame-synchronized, and it stops accruing
 * time the instant the app's own render loop stops.
 */
export class CharacterReveal {
  private readonly app: Application;
  private readonly fireworks: FireworksSystem;
  private readonly root: Container;
  private texture: Texture | null = null;
  private slices: CharacterSlice[] = [];
  private pendingTimers: TickerTimerHandle[] = [];

  constructor(app: Application, worldContainer: Container, fireworks: FireworksSystem) {
    this.app = app;
    this.fireworks = fireworks;
    this.root = new Container();
    worldContainer.addChild(this.root);
  }

  /** Slices the word, then launches one rocket per character (staggered by LAUNCH_STAGGER_MS), each revealing/settling its own slice into place when its own rocket's burst finishes. Resolves once the last character has settled. Empty string resolves immediately. */
  play(options: CharacterRevealOptions): Promise<void> {
    const { text, x, y, style } = options;
    const rotation = options.rotation ?? 0;
    if (text.length === 0) return Promise.resolve();

    const measureText = new Text({ text, style });
    measureText.anchor.set(0.5);
    measureText.position.set(x, y);
    const texture = this.app.renderer.extract.texture({ target: measureText });
    measureText.destroy();
    this.texture = texture;

    const prefixWidths = measurePrefixWidths(text, style);
    const totalWidth = prefixWidths[prefixWidths.length - 1];
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    this.slices = [];
    for (let i = 0; i < text.length; i++) {
      // See this class's own doc comment: character i's slice is measured
      // from the *right* edge inward, not the left, because Arabic's first
      // typed character renders at the right edge of the box.
      const sliceLeft = totalWidth - prefixWidths[i + 1];
      const sliceWidth = Math.max(1, prefixWidths[i + 1] - prefixWidths[i]);
      const sliceTexture = new Texture({ source: texture.source, frame: new Rectangle(sliceLeft, 0, sliceWidth, texture.height) });

      const sprite = new Sprite(sliceTexture);
      sprite.anchor.set(0, 0.5);
      sprite.visible = false;
      sprite.rotation = rotation;
      this.root.addChild(sprite);

      // Offset from the line's own center, along its unrotated baseline —
      // rotated by (cos, sin) around the pivot (x, y) so the whole line of
      // slices reads as one rigid, correctly-tilted row (matches whatever
      // rotation the player set via the control box's rotate handle).
      const dx = sliceLeft - totalWidth / 2;
      this.slices.push({
        sprite,
        targetX: x + dx * cos,
        targetY: y + dx * sin,
      });
    }

    return new Promise((resolve) => {
      let settledCount = 0;
      const total = this.slices.length;
      this.slices.forEach((slice, index) => {
        const timer = tickerSetTimeout(this.app.ticker, () => {
          this.launchCharacter(slice, () => {
            settledCount++;
            if (settledCount >= total) resolve();
          });
        }, index * LAUNCH_STAGGER_MS);
        this.pendingTimers.push(timer);
      });
    });
  }

  private launchCharacter(slice: CharacterSlice, onSettled: () => void): void {
    const launchX = slice.targetX + (Math.random() - 0.5) * 2 * LAUNCH_SPREAD_PX;
    this.fireworks.launch(launchX, undefined, 'strobe', () => this.revealAndSettle(slice, onSettled));
  }

  /** Reveals the slice near its own burst, then eases it home — position, alpha, and scale together — before firing a small settle sparkle from FireworksSystem's own particle pool. */
  private revealAndSettle(slice: CharacterSlice, onSettled: () => void): void {
    const { sprite } = slice;
    sprite.visible = true;
    sprite.alpha = 0;
    sprite.scale.set(1.6);
    const startX = slice.targetX + (Math.random() - 0.5) * 40;
    const startY = slice.targetY - 60 - Math.random() * 40;
    sprite.position.set(startX, startY);

    let elapsedMs = 0;
    const step = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / SETTLE_MOVE_MS);
      const eased = 1 - (1 - progress) ** 3;
      sprite.position.set(startX + (slice.targetX - startX) * eased, startY + (slice.targetY - startY) * eased);
      sprite.alpha = eased;
      sprite.scale.set(1.6 - 0.6 * eased);
      if (progress < 1) return;
      this.app.ticker.remove(step);
      this.fireworks.spawnSettleSparkle(slice.targetX, slice.targetY);
      onSettled();
    };
    this.app.ticker.add(step);
  }

  /** Cancels any pending launches, destroys every sprite and the one shared texture. Safe to call even if play() never resolved (e.g. the player exits mid-reveal). */
  destroy(): void {
    for (const timer of this.pendingTimers) timer.cancel();
    this.pendingTimers = [];
    for (const slice of this.slices) slice.sprite.destroy();
    this.slices = [];
    this.texture?.destroy(true);
    this.texture = null;
    this.root.destroy();
  }
}

/**
 * `prefixWidths[i]` = width of `text.slice(0, i)` measured in isolation, for
 * i = 0..text.length. Measured with Pixi's own `CanvasTextMetrics` — the
 * same static measurer Pixi's `Text` uses internally for its own word-wrap
 * layout — rather than a hand-rolled scratch `<canvas>` + manual `ctx.font`
 * string. That matters beyond ceremony: `CanvasTextMetrics` builds the font
 * string from `style._fontString` (Pixi's own resolver — font family
 * fallback list, weight, style, all handled exactly as the real render
 * does), so a slice boundary can never drift from what Pixi *actually*
 * draws the way a manually-reconstructed `ctx.font` string could.
 */
function measurePrefixWidths(text: string, style: TextStyle): number[] {
  const widths: number[] = [0];
  for (let i = 1; i <= text.length; i++) {
    widths.push(CanvasTextMetrics.measureText(text.slice(0, i), style, undefined, false).width);
  }
  return widths;
}
