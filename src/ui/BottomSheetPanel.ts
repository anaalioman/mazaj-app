import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import { fastSin } from '../fireworks/SineTable';

const SLIDE_MS = 220;
const PANEL_PADDING_X = 16;
const PANEL_PADDING_Y = 14;
const CORNER_RADIUS = 16;
/** Matches the old `@keyframes mzj-glow-row-pulse`: `0.85s ease-in-out 2` — two full in/out cycles. */
const PULSE_CYCLE_MS = 850;
const PULSE_CYCLES = 2;
const PULSE_COLOR = 0xff9f45;
const PULSE_MAX_ALPHA = 0.45;

/**
 * Shared "slides up from the bottom, centered" canvas panel — the Pixi
 * equivalent of the old `.mzj-planning-subpanel` CSS (`border-radius: 16px
 * 16px 0 0`, `width: min(420px, 86vw)`, `background: rgba(255,255,255,0.04)`,
 * `transition: transform 0.22s ease, opacity 0.22s ease`). Subclasses build
 * their own content (sliders, choice buttons) via `addContent()`, then call
 * `finalize()` once with the content height — mirrors SideDockPanel's own
 * pattern (side-docking panels), just docking from the bottom instead of a
 * side.
 */
export abstract class BottomSheetPanel {
  protected readonly app: Application;
  protected readonly panelWidth: number;
  /** Public so PlanningScreen.ts can reparent it into uiContainer — every subpanel is UI chrome, never scene content (see fireworksMood.ts's own container-tree doc comment). */
  readonly container: Container;
  private readonly panelBg: Graphics;
  private readonly pulseRing: Graphics;
  private panelHeight = 0;
  private pulseStart: number | null = null;

  private isOpen = false;
  private animT = 0;
  private animDir = 0;

  protected constructor(app: Application) {
    this.app = app;
    this.panelWidth = Math.min(420, app.screen.width * 0.86);

    this.container = new Container();
    this.container.visible = false;
    app.stage.addChild(this.container);

    this.panelBg = new Graphics();
    this.panelBg.eventMode = 'static';
    // Absorbs every tap anywhere on the sheet (gaps included) so it never
    // leaks through to the stage's own tap-to-fire handler underneath —
    // same reasoning as every other converted control's pointerdown fix.
    this.panelBg.on('pointerdown', (event) => event.stopPropagation());
    this.panelBg.on('pointertap', (event) => event.stopPropagation());
    this.container.addChild(this.panelBg);

    // A ring drawn just outside the panel's own edge — the Pixi equivalent
    // of the old `.mzj-glow-row-pulse` CSS keyframe (see pulse()/tickPulse()
    // below), invisible/inert until pulse() is called.
    this.pulseRing = new Graphics();
    this.pulseRing.visible = false;
    this.pulseRing.eventMode = 'none';
    this.container.addChild(this.pulseRing);

    app.renderer.on('resize', () => this.reflow());
    app.ticker.add(this.tick);
    app.ticker.add(this.tickPulse);
  }

  /**
   * Briefly highlights this panel's own edge with a pulsing orange ring —
   * used by UploadHint to point the player at "توهج الألعاب النارية" right
   * after a background upload, so the glow doesn't wash out their photo/
   * video. Ported from the old CSS keyframe of the same purpose; harmless
   * (silently invisible, matching the old behavior) if the panel happens to
   * be closed when called, since `container.visible` stays false either way.
   */
  pulse(): void {
    this.pulseStart = performance.now();
  }

  private tickPulse = (): void => {
    if (this.pulseStart === null) return;
    const elapsed = performance.now() - this.pulseStart;
    const totalMs = PULSE_CYCLE_MS * PULSE_CYCLES;
    if (elapsed >= totalMs) {
      this.pulseStart = null;
      this.pulseRing.visible = false;
      return;
    }
    const cycleT = (elapsed % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;
    // cycleT * Math.PI is always in [0, PI) ⊂ [0, TWO_PI) — already within
    // fastSin()'s input contract, no wrapping needed.
    const intensity = fastSin(cycleT * Math.PI);
    this.pulseRing.visible = intensity > 0.01;
    if (this.pulseRing.visible) {
      this.pulseRing
        .clear()
        .roundRect(-3, -3, this.panelWidth + 6, this.panelHeight + 6, CORNER_RADIUS + 3)
        .stroke({ width: 3, color: PULSE_COLOR, alpha: PULSE_MAX_ALPHA * intensity });
    }
  };

  get open(): boolean {
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.animDir = open ? 1 : -1;
    if (open) this.container.visible = true;
  }

  /** Local (x, y) where a subclass's first content row should start (below the top padding, after the left padding). */
  protected get contentOrigin(): { x: number; y: number } {
    return { x: PANEL_PADDING_X, y: PANEL_PADDING_Y };
  }

  protected get contentWidth(): number {
    return this.panelWidth - PANEL_PADDING_X * 2;
  }

  protected addContent(child: Container): void {
    this.container.addChild(child);
  }

  /** Subclasses call this once, after building their rows, with the total content height needed. */
  protected finalize(contentHeight: number): void {
    this.panelHeight = PANEL_PADDING_Y * 2 + contentHeight;
    this.drawBackground();
    this.reflow();
  }

  /** Top-left/top-right rounded, bottom corners square — Pixi's `roundRect` rounds all four uniformly, so the old CSS's `16px 16px 0 0` needs a hand-drawn path instead. */
  private drawBackground(): void {
    const w = this.panelWidth;
    const h = this.panelHeight;
    const r = CORNER_RADIUS;
    this.panelBg
      .clear()
      .moveTo(0, h)
      .lineTo(0, r)
      .arcTo(0, 0, r, 0, r)
      .lineTo(w - r, 0)
      .arcTo(w, 0, w, r, r)
      .lineTo(w, h)
      .closePath()
      .fill({ color: 0xffffff, alpha: 0.04 });
    this.panelBg.hitArea = new Rectangle(0, 0, w, h);
  }

  private reflow(): void {
    this.applyPosition();
  }

  private applyPosition(): void {
    const finalY = this.app.screen.height - this.panelHeight;
    const hiddenY = this.app.screen.height + 20;
    this.container.x = (this.app.screen.width - this.panelWidth) / 2;
    this.container.y = hiddenY + (finalY - hiddenY) * this.animT;
    this.container.alpha = this.animT;
  }

  private tick = (ticker: { deltaMS: number }): void => {
    if (this.animDir === 0) return;
    this.animT += (ticker.deltaMS / SLIDE_MS) * this.animDir;
    this.animT = Math.max(0, Math.min(1, this.animT));
    this.applyPosition();
    if (this.animDir > 0 && this.animT >= 1) this.animDir = 0;
    if (this.animDir < 0 && this.animT <= 0) {
      this.animDir = 0;
      this.container.visible = false;
    }
  };
}
