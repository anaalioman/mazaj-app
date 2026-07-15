import { Container, Rectangle, Sprite, Text, TextStyle, Texture, type Application } from 'pixi.js';
import type { FireworksSystem } from '../fireworks/FireworksSystem';

export interface CharacterRevealOptions {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
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
 * Slice boundaries come from measuring cumulative prefix widths on a
 * scratch <canvas> with the same font — not from Pixi's Text object
 * itself, which has no public per-glyph API. For a pure-RTL string, the
 * *first* logical character ends up at the *right* edge of the rendered
 * box and each later character shifts further left (this is how Arabic
 * reads, right-to-left) — so a naive `prefixWidth[i]` as a left-edge
 * offset is backwards; see sliceBounds() below for the correction.
 * Known, accepted approximation: measuring a prefix substring in
 * isolation can shape its own *last* character slightly differently than
 * it would be shaped mid-run in the full string (a joining-form edge
 * case) — a few-pixel-level cosmetic difference, not a correctness bug.
 *
 * Deliberately plain (no stroke/drop-shadow) style for this pass: Pixi's
 * Text canvas adds internal padding to fit a stroke/shadow's own extra
 * pixels, which would offset every glyph from what a stroke-less scratch
 * canvas measurement predicts. Keeping the sliced text unstyled avoids
 * that whole class of error; a per-sprite filter pass for the gold
 * stroke/shadow look is a real, separate follow-up once this core
 * mechanism is confirmed correct on a real device.
 */
export class CharacterReveal {
  private readonly app: Application;
  private readonly fireworks: FireworksSystem;
  private readonly root: Container;
  private texture: Texture | null = null;
  private slices: CharacterSlice[] = [];
  private pendingTimers: number[] = [];

  constructor(app: Application, worldContainer: Container, fireworks: FireworksSystem) {
    this.app = app;
    this.fireworks = fireworks;
    this.root = new Container();
    worldContainer.addChild(this.root);
  }

  /** Slices the word, then launches one rocket per character (staggered by LAUNCH_STAGGER_MS), each revealing/settling its own slice into place when its own rocket's burst finishes. Resolves once the last character has settled. Empty string resolves immediately. */
  play(options: CharacterRevealOptions): Promise<void> {
    const { text, x, y, style } = options;
    if (text.length === 0) return Promise.resolve();

    const measureText = new Text({ text, style });
    measureText.anchor.set(0.5);
    measureText.position.set(x, y);
    const texture = this.app.renderer.extract.texture({ target: measureText });
    measureText.destroy();
    this.texture = texture;

    const prefixWidths = measurePrefixWidths(text, style);
    const totalWidth = prefixWidths[prefixWidths.length - 1];

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
      this.root.addChild(sprite);

      this.slices.push({
        sprite,
        targetX: x - totalWidth / 2 + sliceLeft,
        targetY: y,
      });
    }

    return new Promise((resolve) => {
      let settledCount = 0;
      const total = this.slices.length;
      this.slices.forEach((slice, index) => {
        const timer = window.setTimeout(() => {
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

    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / SETTLE_MOVE_MS);
      const eased = 1 - (1 - t) ** 3;
      sprite.position.set(startX + (slice.targetX - startX) * eased, startY + (slice.targetY - startY) * eased);
      sprite.alpha = eased;
      sprite.scale.set(1.6 - 0.6 * eased);
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      this.fireworks.spawnSettleSparkle(slice.targetX, slice.targetY);
      onSettled();
    };
    requestAnimationFrame(step);
  }

  /** Cancels any pending launches, destroys every sprite and the one shared texture. Safe to call even if play() never resolved (e.g. the player exits mid-reveal). */
  destroy(): void {
    for (const timer of this.pendingTimers) window.clearTimeout(timer);
    this.pendingTimers = [];
    for (const slice of this.slices) slice.sprite.destroy();
    this.slices = [];
    this.texture?.destroy(true);
    this.texture = null;
    this.root.destroy();
  }
}

/** `prefixWidths[i]` = width of `text.slice(0, i)` measured in isolation, for i = 0..text.length. */
function measurePrefixWidths(text: string, style: TextStyle): number[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.direction = 'rtl';
  ctx.font = `${style.fontWeight ?? '400'} ${style.fontSize}px ${style.fontFamily}`;
  const widths: number[] = [0];
  for (let i = 1; i <= text.length; i++) {
    widths.push(ctx.measureText(text.slice(0, i)).width);
  }
  return widths;
}
