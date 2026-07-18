import { Container, Graphics, Text, TextStyle, type Application, type FederatedPointerEvent, type Ticker } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { Transformer, type TransformerTarget } from '../Transformer';
import { EFFECT_GOLD, GLOW_DISTANCE, GLOW_PULSE_MAX, GLOW_PULSE_MIN, GLOW_PULSE_SPEED, GLOW_QUALITY } from './types';

export interface PreviewControlBoxCallbacks {
  /** Fired when the settled text itself is tapped (reopens the composer pre-filled) — see TextComposer's own open(). */
  onTapPreview: () => void;
  /** Fired when the full-screen backdrop (visible only while the control box is open) is tapped — "commit and close" (see TextComposer's own commit()). */
  onCommitRequested: () => void;
}

/**
 * The player's committed text once it's left the composer: a real, plain
 * `Text` on `worldContainer` (genuine scene content — captured by
 * snapshot/recording exactly like the rest of the show) with a continuous
 * "breathing" gold glow, draggable/pinch-resizable/rotatable via a
 * `Transformer` built fresh for each editing session (see Transformer.ts's
 * own doc comment for why nothing here keeps a permanent gated listener for
 * it: `openControlBox()`/`closeControlBox()` construct/destroy one exactly
 * when editing starts/ends).
 *
 * Owns `posX`/`posY`/`scale`/`rotation` as the one source of truth for
 * where/how big/how tilted the settled text is — the Transformer only ever
 * reports a gesture result back up via its own `onMove`/`onRotate`/
 * `onScale` callbacks (wired once, internally, in openControlBox()); it
 * never mutates these fields directly itself.
 */
export class PreviewControlBox {
  private readonly app: Application;
  private readonly uiContainer: Container;
  private readonly baseFontSize: number;

  readonly previewText: Text;
  private readonly previewGlow: GlowFilter;
  private transformer: Transformer | null = null;
  /** Full-screen, invisible-but-hit-testable — catches "tap outside the box" to commit. Sits directly under the Transformer's own box/handles on `uiContainer` so they always win the hit test over it. Visibility is tied 1:1 to whether a control box is actually open (see openControlBox()/closeControlBox()) — owned here rather than by TextComposer specifically so that invariant can never drift out of sync the way splitting it apart once did. */
  private readonly backdrop: Graphics;

  posX: number;
  posY: number;
  scale = 1;
  /** Radians — see TextRevealConfig's own doc comment (types.ts) for the convention. */
  rotation = 0;

  constructor(app: Application, worldContainer: Container, uiContainer: Container, baseFontSize: number, initialX: number, initialY: number, callbacks: PreviewControlBoxCallbacks) {
    this.app = app;
    this.uiContainer = uiContainer;
    this.baseFontSize = baseFontSize;
    this.posX = initialX;
    this.posY = initialY;

    this.previewText = new Text({ text: '', style: this.textStyle() });
    this.previewText.anchor.set(0.5);
    this.previewText.visible = false;
    this.previewText.eventMode = 'static';
    this.previewText.cursor = 'pointer';
    this.previewGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: GLOW_PULSE_MIN, innerStrength: 0, color: EFFECT_GOLD, quality: GLOW_QUALITY });
    this.previewText.filters = [this.previewGlow];
    app.ticker.add((ticker) => this.syncPreviewGlow(ticker));

    this.previewText.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      callbacks.onTapPreview();
    });
    worldContainer.addChild(this.previewText);
    this.syncPreviewTransform();

    // A near-zero-alpha fill so it's still real drawn geometry (Pixi
    // hit-tests a Graphics against its own shape when no explicit `hitArea`
    // is set), matching how `app.stage.hitArea` itself is kept in sync on
    // resize (see fireworksMood.ts).
    const { width, height } = app.screen;
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.001 });
    this.backdrop.eventMode = 'static';
    this.backdrop.visible = false;
    this.backdrop.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      callbacks.onCommitRequested();
    });
    uiContainer.addChild(this.backdrop);
    app.renderer.on('resize', () => {
      const screen = app.screen;
      this.backdrop.clear().rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.001 });
    });
  }

  get isOpen(): boolean {
    return this.transformer !== null;
  }

  setText(text: string): void {
    this.previewText.text = text;
  }

  show(): void {
    this.previewText.visible = true;
  }

  hide(): void {
    this.previewText.visible = false;
  }

  get visible(): boolean {
    return this.previewText.visible;
  }

  private textStyle(): TextStyle {
    return new TextStyle({
      fontFamily: 'Tajawal, system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(this.baseFontSize * this.scale),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });
  }

  private syncPreviewTransform(): void {
    this.previewText.position.set(this.posX, this.posY);
    this.previewText.rotation = this.rotation;
    this.previewText.style = this.textStyle();
  }

  /**
   * Drives the committed text's "breathing" glow — registered once on
   * `app.ticker` in the constructor, gated on `previewText.visible` (the
   * ticker itself is shared and always running, so anything per-mode has to
   * stand down explicitly rather than relying on the ticker being paused).
   * `ticker.lastTime` is a plain millisecond clock the shared ticker already
   * advances every frame — feeding it straight into `Math.sin` needs no
   * timer, no accumulator field, no per-frame allocation: only a single
   * `outerStrength` uniform write on the one `GlowFilter` instance built in
   * the constructor.
   */
  private syncPreviewGlow(ticker: Ticker): void {
    if (!this.previewText.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(ticker.lastTime * GLOW_PULSE_SPEED);
    this.previewGlow.outerStrength = GLOW_PULSE_MIN + pulse * (GLOW_PULSE_MAX - GLOW_PULSE_MIN);
  }

  /** A plain snapshot of everything the Transformer needs to draw itself — `previewText.width/height` already reflect the current `scale` (see textStyle(), which drives fontSize from it), so the border always matches the text's real on-screen size with no separate scaling step of its own. */
  private transformerTarget(): TransformerTarget {
    return {
      x: this.posX,
      y: this.posY,
      rotation: this.rotation,
      scale: this.scale,
      contentWidth: this.previewText.width,
      contentHeight: this.previewText.height,
    };
  }

  /**
   * Builds a fresh `Transformer` for this one editing session — see
   * Transformer.ts's own doc comment for why it is constructed here rather
   * than once up front and merely shown/hidden: no gesture listener for it
   * exists on `app.stage` at all while nothing is being edited.
   * `onMove`/`onRotate`/`onScale` are the only way the Transformer ever
   * changes anything — it reports a gesture result, this class remains the
   * one place `posX`/`posY`/`scale`/`rotation` actually live.
   */
  openControlBox(): void {
    this.backdrop.visible = true;
    this.transformer = new Transformer(this.app, this.uiContainer, this.transformerTarget(), {
      onMove: (x, y) => {
        this.posX = x;
        this.posY = y;
        this.syncTransforms();
      },
      onRotate: (rotation) => {
        this.rotation = rotation;
        this.syncTransforms();
      },
      onScale: (scale) => {
        this.scale = scale;
        this.syncTransforms();
      },
    });
  }

  /** Tears the Transformer down completely — see Transformer.destroy()'s own doc comment. */
  closeControlBox(): void {
    this.backdrop.visible = false;
    this.transformer?.destroy();
    this.transformer = null;
  }

  /** Called after any gesture callback (move/rotate/scale) changes posX/posY/rotation/scale: repaints the actual text, then hands the Transformer a fresh snapshot to redraw its border/handles against. */
  private syncTransforms(): void {
    this.syncPreviewTransform();
    this.transformer?.update(this.transformerTarget());
  }

  /** Re-applies the current posX/posY/rotation/scale to the visible text — used by TextComposer whenever it changes these directly (a fresh commit) without going through a Transformer gesture. */
  refreshTransform(): void {
    this.syncPreviewTransform();
  }
}
