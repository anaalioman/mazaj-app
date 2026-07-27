import { Application, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, TextStyle } from 'pixi.js';
import { iconTexture } from './svgIconTexture';

const SLIDE_MS = 220;
const PANEL_TOP_INSET = 16;
const PANEL_LEFT_INSET = 12;
const PANEL_PADDING = 10;
const ROW_HEIGHT = 54;
const ICON_SIZE = 24;
const ROW_WIDTH = 96;
const SLIDER_WIDTH = 28;
const SLIDER_GAP = 10;
const TRACK_WIDTH = 3;
const THUMB_BAR_WIDTH = 20;
const THUMB_BAR_HEIGHT = 2.5;
const THUMB_DOT_RADIUS = 4.5;
/** Real Pixi hitArea per finger, same convention as every other draggable control (PixiSlider, PlanningMode's pins). */
const THUMB_HIT_SIZE = 44;
const GOLD = 0xffe9b3;

export interface BackdropControlsPanelOptions {
  app: Application;
  onTapVideo: () => void;
  onTapImage: () => void;
  dimmerInitialValue: number;
  onDimmerChange: (value: number) => void;
}

interface IconRow {
  root: Container;
  ring: Graphics;
}

/**
 * "فيديو خلفية حي" + "صورة خلفية" + the bare vertical brightness fader — all
 * three moved out of the main icon column entirely into one self-contained
 * floating group, so their visibility can be driven by the player's actual
 * planning context (see PlanningScreen.syncBackdropControlsVisibility())
 * instead of the main column's own hide/show state — the whole point being
 * that these three stay visible together with "الأشكال" (or random/auto-show
 * arming) even while the main column itself has slid away for placement.
 * Docks at a fixed top-left spot deliberately: both ShapesPanel and this
 * group can be on screen at the same time by design, and ShapesPanel's own
 * dock position moves depending on whether it's open — a fixed corner is
 * the only spot guaranteed to never collide with it either way.
 */
export class BackdropControlsPanel {
  readonly container: Container;
  private readonly app: Application;
  private readonly panelBg: Graphics;
  private readonly videoRow: IconRow;
  private readonly imageRow: IconRow;
  private readonly track: Graphics;
  private readonly fill: Graphics;
  private readonly thumb: Graphics;
  private readonly onTapVideo: () => void;
  private readonly onTapImage: () => void;
  private readonly onDimmerChange: (value: number) => void;
  private dimmerValue: number;
  private dragging = false;
  private isOpen = false;
  private animT = 0;
  private animDir = 0;
  private panelWidth = 0;
  private panelHeight = 0;
  private trackTop = 0;
  private trackHeight = 0;

  constructor(options: BackdropControlsPanelOptions) {
    this.app = options.app;
    this.onTapVideo = options.onTapVideo;
    this.onTapImage = options.onTapImage;
    this.onDimmerChange = options.onDimmerChange;
    this.dimmerValue = options.dimmerInitialValue;

    this.container = new Container();
    this.container.visible = false;

    this.panelBg = new Graphics();
    this.panelBg.eventMode = 'static';
    this.panelBg.on('pointerdown', (event) => event.stopPropagation());
    this.panelBg.on('pointertap', (event) => event.stopPropagation());
    this.container.addChild(this.panelBg);

    this.track = new Graphics();
    this.track.eventMode = 'static';
    this.track.cursor = 'pointer';
    this.container.addChild(this.track);
    this.fill = new Graphics();
    this.container.addChild(this.fill);
    this.thumb = new Graphics();
    this.thumb.eventMode = 'static';
    this.thumb.cursor = 'grab';
    this.thumb.hitArea = new Rectangle(-THUMB_HIT_SIZE / 2, -THUMB_HIT_SIZE / 2, THUMB_HIT_SIZE, THUMB_HIT_SIZE);
    this.container.addChild(this.thumb);

    this.videoRow = this.buildRow('camera', 'فيديو خلفية حي', () => this.onTapVideo());
    this.imageRow = this.buildRow('image', 'صورة خلفية', () => this.onTapImage());

    this.wireDrag();
    this.layout();
    this.app.renderer.on('resize', () => this.layout());
    this.app.ticker.add(this.tick);
  }

  get open(): boolean {
    return this.isOpen;
  }

  setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.animDir = open ? 1 : -1;
    if (open) this.container.visible = true;
  }

  /** Mirrors PlanningIconColumn.setActive() — the persistent "a backdrop of this type is currently set" cue, ported over from the old icon-column rows. */
  setVideoActive(active: boolean): void {
    this.drawRing(this.videoRow, active);
  }

  setImageActive(active: boolean): void {
    this.drawRing(this.imageRow, active);
  }

  private buildRow(icon: 'camera' | 'image', label: string, onTap: () => void): IconRow {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(0, 0, ROW_WIDTH, ROW_HEIGHT);
    this.container.addChild(root);

    const ring = new Graphics();
    root.addChild(ring);

    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.tint = GOLD;
    sprite.width = ICON_SIZE;
    sprite.height = ICON_SIZE;
    sprite.position.set(ROW_WIDTH / 2, ROW_HEIGHT / 2 - 8);
    root.addChild(sprite);
    void iconTexture(icon, 48, '#ffffff').then((texture) => {
      sprite.texture = texture;
    }).catch((error: unknown) => {
      console.error('تعذّر تحميل أيقونة اللوحة:', error);
    });

    const text = new Text({
      text: label,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffffff, align: 'center' }),
    });
    text.anchor.set(0.5, 0);
    text.position.set(ROW_WIDTH / 2, ROW_HEIGHT / 2 + 8);
    root.addChild(text);

    root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      onTap();
    });

    return { root, ring };
  }

  private drawRing(row: IconRow, active: boolean): void {
    row.ring.clear();
    if (active) {
      row.ring.roundRect(4, 4, ROW_WIDTH - 8, ROW_HEIGHT - 8, 8).stroke({ width: 2, color: GOLD, alpha: 0.85 });
    }
  }

  private layout(): void {
    this.panelWidth = PANEL_PADDING * 2 + SLIDER_WIDTH + SLIDER_GAP + ROW_WIDTH;
    this.panelHeight = PANEL_PADDING * 2 + ROW_HEIGHT * 2;

    this.panelBg
      .clear()
      .rect(0, 0, this.panelWidth, this.panelHeight)
      .fill({ color: 0x0a0a14, alpha: 0.6 })
      .stroke({ width: 1.5, color: GOLD, alpha: 0.7 });
    this.panelBg.hitArea = new Rectangle(0, 0, this.panelWidth, this.panelHeight);

    this.videoRow.root.position.set(PANEL_PADDING + SLIDER_WIDTH + SLIDER_GAP, PANEL_PADDING);
    this.imageRow.root.position.set(PANEL_PADDING + SLIDER_WIDTH + SLIDER_GAP, PANEL_PADDING + ROW_HEIGHT);

    this.trackTop = PANEL_PADDING;
    this.trackHeight = this.panelHeight - PANEL_PADDING * 2;
    const trackCenterX = PANEL_PADDING + SLIDER_WIDTH / 2;
    this.track
      .clear()
      .roundRect(trackCenterX - TRACK_WIDTH / 2, this.trackTop, TRACK_WIDTH, this.trackHeight, TRACK_WIDTH / 2)
      .fill({ color: GOLD, alpha: 0.25 });
    this.track.hitArea = new Rectangle(trackCenterX - THUMB_HIT_SIZE / 2, this.trackTop, THUMB_HIT_SIZE, this.trackHeight);

    this.applyPosition();
    this.syncThumbAndFill();
  }

  private applyPosition(): void {
    const dockX = PANEL_LEFT_INSET;
    const hiddenX = -this.panelWidth - 20;
    this.container.x = hiddenX + (dockX - hiddenX) * this.animT;
    this.container.y = PANEL_TOP_INSET;
    this.container.alpha = this.animT;
  }

  private syncThumbAndFill(): void {
    const trackCenterX = PANEL_PADDING + SLIDER_WIDTH / 2;
    // Top of the track = brightest (value 1) — a physical dimmer's own
    // up-is-brighter convention.
    const t = 1 - this.dimmerValue;
    const thumbY = this.trackTop + t * this.trackHeight;

    this.fill
      .clear()
      .roundRect(trackCenterX - TRACK_WIDTH / 2, thumbY, TRACK_WIDTH, this.trackTop + this.trackHeight - thumbY, TRACK_WIDTH / 2)
      .fill({ color: GOLD, alpha: 0.9 });

    // Mixer-fader look: a short horizontal grip bar with a small solid dot
    // centered on it — no ring/stroke around the dot.
    this.thumb
      .clear()
      .roundRect(-THUMB_BAR_WIDTH / 2, -THUMB_BAR_HEIGHT / 2, THUMB_BAR_WIDTH, THUMB_BAR_HEIGHT, THUMB_BAR_HEIGHT / 2)
      .fill({ color: GOLD, alpha: 0.95 })
      .circle(0, 0, THUMB_DOT_RADIUS)
      .fill({ color: GOLD });
    this.thumb.position.set(trackCenterX, thumbY);
  }

  private setValueFromLocalY(localY: number): void {
    const t = Math.max(0, Math.min(1, (localY - this.trackTop) / this.trackHeight));
    const value = Math.max(0, Math.min(1, 1 - t));
    if (value === this.dimmerValue) return;
    this.dimmerValue = value;
    this.syncThumbAndFill();
    this.onDimmerChange(this.dimmerValue);
  }

  private wireDrag(): void {
    const startDrag = (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.dragging = true;
      this.setValueFromLocalY(this.container.toLocal(event.global).y);
    };
    this.thumb.on('pointerdown', startDrag);
    this.track.on('pointerdown', startDrag);

    this.app.stage.on('pointermove', (event: FederatedPointerEvent) => {
      if (!this.dragging) return;
      this.setValueFromLocalY(this.container.toLocal(event.global).y);
    });
    const endDrag = () => {
      this.dragging = false;
    };
    this.app.stage.on('pointerup', endDrag);
    this.app.stage.on('pointerupoutside', endDrag);
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
