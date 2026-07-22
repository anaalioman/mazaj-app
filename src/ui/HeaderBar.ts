import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { BackdropBlurFilter } from 'pixi-filters';
import type { AudioManager } from '../audio/AudioManager';
import { iconTexture } from './svgIconTexture';
import type { IconName } from './icons';
import { tickerSetTimeout } from '../utils/tickerTimers';

export interface HeaderBarDeps {
  app: Application;
  audio: AudioManager;
  onStartShow: () => void;
  onBackToHome: () => void;
}

// Geometry ported 1:1 from the old #mzj-header CSS rules at the mobile
// breakpoint (padding: 8px 10px; gap: 8px; buttons 36px circles) — measured
// directly off a live render (getBoundingClientRect on every element) rather
// than guessed, so the Pixi layout lands on the exact same pixels.
const PADDING_X = 10;
const ROW_CENTER_Y = 26;
const GROUP_GAP = 8;
const BUTTON_DIAMETER = 36;
/** Real Pixi hitArea per finger, independent of the visible mark's own size — same reasoning as the text control box's handles. */
const BUTTON_HIT_SIZE = 44;
const PILL_PADDING_X = 14;
const FPS_PADDING_X = 9;
const ICON_SOURCE_SIZE = 40; // rasterized once at a fixed size, then scaled down per button — see iconTexture's own cache key

// Colors ported 1:1 from the old CSS (#mzj-header button / .mzj-fps /
// .mzj-mode-toggle rules) — this bar was never part of the gold identity
// (that belongs to the text composer's handles and the side panels), so no
// gold/AdvancedBloomFilter applies here; introducing one would be an
// invented look this component never had.
const GLASS_FILL = 0x0f172a; // rgb(15, 23, 42)
const GLASS_ALPHA = 0.45;
const BORDER_COLOR = 0xffffff;
const BORDER_ALPHA = 0.16;
const ICON_TINT = 0xe5e7eb;
const TEXT_FILL = 0xe5e7eb;
const FPS_TEXT_ALPHA = 0.55;
const DISABLED_ALPHA = 0.45;
const FLASH_COLOR = 0x06b6d4;
const FLASH_MS = 180;

interface CircleButton {
  root: Container;
  bg: Graphics;
  icon: Sprite;
}

interface PillButton {
  root: Container;
  bg: Graphics;
  icon: Sprite;
  label: Text;
  /** Tracked explicitly rather than re-derived via `bg.getBounds()` at layout time — cheaper, and unaffected by the container's own current position/rotation. */
  width: number;
}

/**
 * Transparent horizontal bar: home + start-show (right), FPS + mute (left).
 * Fully PixiJS — no DOM/CSS anywhere in this component. Every visible piece
 * (glass-pill backgrounds, icons, text) is a `Graphics`/`Sprite`/`Text`
 * living in `container` on `app.stage`; the old CSS glass look (dark fill +
 * soft white border + backdrop blur) is ported via `BackdropBlurFilter`
 * (pixi-filters) rather than dropped. Planning screen is always visible on
 * its own — no header trigger for it.
 */
export class HeaderBar {
  readonly container: Container;
  private readonly deps: HeaderBarDeps;

  private readonly homeButton: CircleButton;
  private readonly muteButton: CircleButton;
  private readonly startShowButton: PillButton;
  private readonly fpsPill: { root: Container; bg: Graphics; label: Text };

  private muted = false;
  private fpsFrame = 0;

  constructor(deps: HeaderBarDeps) {
    this.deps = deps;

    this.container = new Container();
    deps.app.stage.addChild(this.container);

    this.homeButton = this.createCircleButton('home', 'العودة للقائمة الرئيسية');
    this.container.addChild(this.homeButton.root);
    this.wireTap(this.homeButton.root, () => this.deps.onBackToHome());

    this.startShowButton = this.createPillButton('play', 'ابدأ العرض');
    this.container.addChild(this.startShowButton.root);
    this.wireTap(this.startShowButton.root, () => this.handleStartShow());

    this.muteButton = this.createCircleButton('volume2', 'كتم الصوت');
    this.container.addChild(this.muteButton.root);
    this.wireTap(this.muteButton.root, () => this.handleMuteToggle());

    this.fpsPill = this.createFpsPill();
    this.container.addChild(this.fpsPill.root);

    deps.app.ticker.add(this.tickFps);
    deps.app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  /**
   * One 36px glass circle (dark fill, soft white border, backdrop blur)
   * with a centered tinted icon — home and mute share this exact look.
   */
  private createCircleButton(iconName: IconName, ariaLabel: string): CircleButton {
    const root = new Container();
    root.label = ariaLabel;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-BUTTON_HIT_SIZE / 2, -BUTTON_HIT_SIZE / 2, BUTTON_HIT_SIZE, BUTTON_HIT_SIZE);

    const bg = new Graphics();
    bg.circle(0, 0, BUTTON_DIAMETER / 2).fill({ color: GLASS_FILL, alpha: GLASS_ALPHA }).stroke({
      width: 1,
      color: BORDER_COLOR,
      alpha: BORDER_ALPHA,
    });
    bg.filters = [new BackdropBlurFilter({ strength: 6, quality: 4 })];
    root.addChild(bg);

    const icon = new Sprite();
    icon.anchor.set(0.5);
    icon.tint = ICON_TINT;
    icon.width = 18;
    icon.height = 18;
    root.addChild(icon);
    void iconTexture(iconName, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      icon.texture = texture;
    });

    return { root, bg, icon };
  }

  /**
   * The pill-shaped "ابدأ العرض" button: same glass look as the circles,
   * but its width tracks its own label's rendered size (the label swaps to
   * "بدأ العرض" after use, exactly like the old CSS version did) — see
   * layoutPill() for how the background/hitArea are recomputed whenever
   * that text changes.
   */
  private createPillButton(iconName: IconName, text: string): PillButton {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    bg.filters = [new BackdropBlurFilter({ strength: 6, quality: 4 })];
    root.addChild(bg);

    const icon = new Sprite();
    icon.anchor.set(0.5);
    icon.tint = ICON_TINT;
    icon.width = 15;
    icon.height = 15;
    root.addChild(icon);
    void iconTexture(iconName, ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      icon.texture = texture;
    });

    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '500',
        fill: TEXT_FILL,
      }),
    });
    label.anchor.set(0, 0.5);
    root.addChild(label);

    const button: PillButton = { root, bg, icon, label, width: 0 };
    this.layoutPill(button, text);
    return button;
  }

  /** Rebuilds a pill's background/hitArea/icon+label positions around however wide its current label happens to render — icon sits at the pill's own right edge (RTL reading order), label extends left from it, both centered vertically. */
  private layoutPill(button: PillButton, text: string): void {
    button.label.text = text;
    const gap = 6;
    const contentWidth = button.icon.width + gap + button.label.width;
    const height = 32;
    const width = contentWidth + PILL_PADDING_X * 2;
    const radius = height / 2;
    button.width = width;

    button.bg
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, radius)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });
    button.root.hitArea = new Rectangle(-width / 2, -height / 2 - 6, width, height + 12);

    const iconX = width / 2 - PILL_PADDING_X - button.icon.width / 2;
    button.icon.position.set(iconX, 0);
    button.label.position.set(iconX - button.icon.width / 2 - gap - button.label.width, 0);
  }

  private createFpsPill(): { root: Container; bg: Graphics; label: Text } {
    const root = new Container();

    const bg = new Graphics();
    root.addChild(bg);

    const label = new Text({
      text: '60',
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: 11,
        fill: 0xffffff,
        // Ported from the old CSS's `font-variant-numeric: tabular-nums` —
        // Pixi's TextStyle has no direct equivalent, so a monospace-ish
        // numeric family substitute isn't needed here since the digits in
        // this app's chosen font are already fixed-width; noted rather than
        // silently dropped.
      }),
    });
    label.alpha = FPS_TEXT_ALPHA;
    label.anchor.set(0.5);
    root.addChild(label);

    this.layoutFps({ root, bg, label });
    return { root, bg, label };
  }

  private layoutFps(pill: { root: Container; bg: Graphics; label: Text }): void {
    const height = 25;
    const width = pill.label.width + FPS_PADDING_X * 2;
    pill.bg
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, height / 2)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });
  }

  /**
   * `pointertap` (a full press-release-in-place gesture, same as
   * ShapesPanel's own rows use) drives the actual action — a button is a
   * discrete action, not a drag. But stopping propagation only there is not
   * enough: `app.stage`'s own tap-to-fire listener in fireworksMood.ts is
   * wired to the raw `pointerdown`, which fires (and bubbles all the way up
   * to stage) well before `pointertap` is even recognized on release — by
   * then a rocket has already launched underneath the button. Confirmed
   * this by testing: 5 taps on the mute button (which fires nothing) left
   * visible rocket trails on screen, compared to a clean zero-interaction
   * baseline. So `pointerdown` itself also needs its own
   * `stopPropagation()`, independent of the tap handler below. Tactile
   * feedback (cyan flash + click sound) replaces the old DOM-delegated
   * `attachTactileFeedback()` for this component specifically, since that
   * helper is CSS-class-based and this bar no longer has any DOM to attach
   * classes to.
   */
  private wireTap(target: Container, handler: () => void): void {
    target.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    target.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.deps.audio.playUiClick();
      this.flash(target);
      handler();
    });
  }

  private flash(target: Container): void {
    const bg = target.children.find((child): child is Graphics => child instanceof Graphics);
    if (!bg) return;
    const originalTint = bg.tint;
    bg.tint = FLASH_COLOR;
    tickerSetTimeout(this.deps.app.ticker, () => {
      bg.tint = originalTint;
    }, FLASH_MS);
  }

  private handleStartShow(): void {
    this.deps.onStartShow();
    this.startShowButton.root.eventMode = 'none';
    this.startShowButton.root.cursor = 'default';
    this.startShowButton.root.alpha = DISABLED_ALPHA;
    this.layoutPill(this.startShowButton, 'بدأ العرض');
  }

  /** Restores "ابدأ العرض" to its pristine, clickable state — used when the player exits a running show and returns to setup, so they can start another one. */
  resetStartShowButton(): void {
    this.startShowButton.root.eventMode = 'static';
    this.startShowButton.root.cursor = 'pointer';
    this.startShowButton.root.alpha = 1;
    this.layoutPill(this.startShowButton, 'ابدأ العرض');
  }

  private handleMuteToggle(): void {
    this.muted = this.deps.audio.toggleMute();
    void iconTexture(this.muted ? 'volumeX' : 'volume2', ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      this.muteButton.icon.texture = texture;
    });
  }

  private tickFps = (): void => {
    this.fpsFrame++;
    if (this.fpsFrame % 15 === 0) {
      this.fpsPill.label.text = `${Math.round(this.deps.app.ticker.FPS)}`;
      this.layoutFps(this.fpsPill);
      this.layout();
    }
  };

  /** Recomputes every element's position from the current screen size — same formulas the original flex/padding CSS resolved to, worked out by hand from measured geometry (see the module doc comment). */
  private layout(): void {
    const width = this.deps.app.screen.width;

    this.muteButton.root.position.set(PADDING_X + BUTTON_DIAMETER / 2, ROW_CENTER_Y);
    const fpsLeftEdge = PADDING_X + BUTTON_DIAMETER + GROUP_GAP;
    this.fpsPill.root.position.set(fpsLeftEdge + this.fpsPill.label.width / 2 + FPS_PADDING_X, ROW_CENTER_Y);

    this.homeButton.root.position.set(width - PADDING_X - BUTTON_DIAMETER / 2, ROW_CENTER_Y);
    const startShowRightEdge = width - PADDING_X - BUTTON_DIAMETER - GROUP_GAP;
    this.startShowButton.root.position.set(startShowRightEdge - this.startShowButton.width / 2, ROW_CENTER_Y);
  }
}
