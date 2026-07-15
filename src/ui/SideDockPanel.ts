import { Application, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';

const SLIDE_MS = 220;
const PANEL_PADDING = 16;
const TITLE_AREA = 56;
// Gap kept clear between the panel's own edge and the icon column it docks
// beside, so it never touches/overlaps the icons themselves.
const DOCK_GAP = 14;
// Bottom safe-area clearance (system nav bars etc.) — matches
// PlanningIconColumn's own PADDING_BOTTOM. Centering alone used to only
// floor the panel's *top* edge on short screens, so a tall panel's bottom
// could still extend past app.screen.height entirely — see reflow()'s own
// doc comment for the real, reproduced case this fixes.
const SAFE_BOTTOM_MARGIN = 60;

/**
 * Shared "docks beside the planning screen's right icon column" canvas
 * panel: rounded glowing background + AdvancedBloomFilter + glowing title
 * text + slide-in/out animation, all fully PixiJS (no HTML/CSS). Subclasses
 * (ColorPickerPanel, ShapesPanel) build their own row content via
 * `addContent()`, then call `finalize()` once with the total content
 * height — every side panel this way shares identical geometry/behavior
 * instead of drifting apart, and `getLeftBoundary` reports the icon
 * column's live on-screen left edge so the dock position stays correct
 * even if that column reflows.
 */
export abstract class SideDockPanel {
  protected readonly app: Application;
  protected readonly panelWidth: number;
  private readonly getLeftBoundary: () => number;
  private readonly onOpenChange?: (open: boolean) => void;
  /** Public so PlanningScreen.ts can reparent it into uiContainer — the color/shapes panels are UI chrome, never scene content (see fireworksMood.ts's own container-tree doc comment). */
  readonly container: Container;
  private readonly panelBg: Graphics;
  private readonly title: Text;
  private panelHeight = 0;

  private isOpen = false;
  private animT = 0;
  private animDir = 0;

  protected constructor(
    app: Application,
    title: string,
    panelWidth: number,
    getLeftBoundary: () => number,
    onOpenChange?: (open: boolean) => void,
  ) {
    this.app = app;
    this.panelWidth = panelWidth;
    this.getLeftBoundary = getLeftBoundary;
    this.onOpenChange = onOpenChange;

    this.container = new Container();
    this.container.visible = false;
    this.container.filters = [
      new AdvancedBloomFilter({ threshold: 0.35, blur: 4, quality: 4, bloomScale: 1.2, brightness: 1 }),
    ];
    app.stage.addChild(this.container);

    this.panelBg = new Graphics();
    this.panelBg.eventMode = 'static';
    // Absorbs every tap anywhere on the panel (gaps included) so it never
    // leaks through to the stage's own tap-to-fire handler underneath.
    // `pointerdown` must be stopped too, not just `pointertap` — the raw
    // `pointerdown` bubbles to `app.stage` and fires the rocket listener
    // well before `pointertap` is even recognized on release (see
    // HeaderBar.wireTap()'s doc comment for the original discovery of this;
    // confirmed leaking here too via an actual reproduced rocket burst
    // before this fix).
    this.panelBg.on('pointerdown', (event) => event.stopPropagation());
    this.panelBg.on('pointertap', (event) => event.stopPropagation());
    this.container.addChild(this.panelBg);

    this.title = new Text({
      text: title,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontWeight: '800',
        fontSize: 12,
        fill: 0xffe9b3,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: panelWidth - PANEL_PADDING * 2,
      }),
    });
    this.title.anchor.set(0.5, 0);
    this.title.position.set(panelWidth / 2, PANEL_PADDING);
    this.container.addChild(this.title);

    app.renderer.on('resize', () => this.reflow());
    app.ticker.add(this.tick);
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.animDir = open ? 1 : -1;
    if (open) this.container.visible = true;
    this.onOpenChange?.(open);
  }

  /** Local y where a subclass's first content row should start (below the title). */
  protected get contentTop(): number {
    return PANEL_PADDING + TITLE_AREA;
  }

  /** Adds a display object as panel content — position it relative to the panel's own local origin (0,0 = top-left), e.g. using `contentTop`. */
  protected addContent(child: Container): void {
    this.container.addChild(child);
  }

  /** Subclasses call this once, after building their rows, with the total content height needed below the title. */
  protected finalize(contentHeight: number): void {
    this.panelHeight = TITLE_AREA + contentHeight + PANEL_PADDING * 2;
    this.panelBg
      .clear()
      .roundRect(0, 0, this.panelWidth, this.panelHeight, 18)
      .fill({ color: 0x0a0a14, alpha: 0.6 })
      .stroke({ width: 1.5, color: 0xffe9b3, alpha: 0.35 });
    this.panelBg.hitArea = new Rectangle(0, 0, this.panelWidth, this.panelHeight);
    this.reflow();
  }

  private reflow(): void {
    // Vertically centered on screen, matching how the icon column beside it
    // is centered (see .mzj-planning-side's justify-content: center) — but
    // never past either safe-area edge. Previously only the top was ever
    // floored (Math.max(8, ...)); on a short enough screen relative to this
    // panel's own content height, the centered position still let the
    // bottom edge render past app.screen.height entirely. Cap it so the
    // panel's bottom never crosses SAFE_BOTTOM_MARGIN from the screen edge,
    // even if that means giving up perfect centering on a short screen.
    const centeredY = Math.max(8, (this.app.screen.height - this.panelHeight) / 2);
    const maxY = Math.max(8, this.app.screen.height - SAFE_BOTTOM_MARGIN - this.panelHeight);
    this.container.y = Math.min(centeredY, maxY);
    this.applyPosition();
  }

  private applyPosition(): void {
    const dockX = this.getLeftBoundary() - DOCK_GAP - this.panelWidth;
    const hiddenX = this.app.screen.width;
    this.container.x = hiddenX + (dockX - hiddenX) * this.animT;
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
