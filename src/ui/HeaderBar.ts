import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { BackdropBlurFilter } from 'pixi-filters';
import type { AudioManager } from '../audio/AudioManager';
import { atlasTexture } from './svgIconTexture';
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
// than guessed, so the Pixi layout lands on the exact same pixels at
// REFERENCE_WIDTH. Every size below is multiplied by `this.scale` (see
// computeScale()) before use, the same width-ratio approach already used by
// HomeScreen.ts's NARROW_BREAKPOINT and TextComposer's COMPOSER_WIDTH_RATIO.
const PADDING_X = 10;
const ROW_CENTER_Y = 26;
const GROUP_GAP = 8;
const BUTTON_DIAMETER = 36;
const CIRCLE_ICON_SIZE = 18;
/** Accessibility floor per finger, independent of the visible mark's own scaled size — same reasoning as the text control box's handles. Never scaled down, only up. */
const BUTTON_HIT_SIZE = 44;
const PILL_PADDING_X = 14;
const PILL_ICON_SIZE = 15;
const PILL_HEIGHT = 32;
const PILL_FONT_SIZE = 13;
const PILL_GAP = 6;
const FPS_PADDING_X = 9;
const FPS_HEIGHT = 25;
const FPS_FONT_SIZE = 11;

// Width these px values were measured at (the app's own mobile breakpoint —
// see the comment above). Screen widths on either side scale every visual
// size by the same ratio, clamped so a very narrow or very wide device
// never balloons/shrinks past a usable range.
const REFERENCE_WIDTH = 400;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.25;

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

interface FpsPill {
  root: Container;
  bg: Graphics;
  label: Text;
  /** Sized from the widest realistic reading ("120") in createFpsPill()/applyFpsScale() — only redrawn there (on creation or a scale change), never per tick, so tickFps() only ever mutates `label.text`. */
  width: number;
}

// Widest FPS reading this app will ever realistically display — sizes the
// pill's background once so it never has to be re-measured/redrawn as the
// live digit count changes (single-digit drops vs. steady 60/120).
const FPS_WIDEST_READING = '120';
// Header content height at REFERENCE_WIDTH (scale 1) for the single shared
// backdrop-blur filter below — same reasoning as FireworksSystem.ts's own
// `layer.filterArea` doc comment: without a fixed area, a filtered
// container's processing region is recomputed from its own display-object
// bounds every frame. Scaled by `this.scale` in layout() along with
// everything else.
const HEADER_FILTER_HEIGHT = 60;

/**
 * Transparent horizontal bar: home + start-show (right), FPS + mute (left).
 * Fully PixiJS — no DOM/CSS anywhere in this component. Every visible piece
 * (glass-pill backgrounds, icons, text) is a `Graphics`/`Sprite`/`Text`
 * living in `container` on `app.stage`; the old CSS glass look (dark fill +
 * soft white border + backdrop blur) is ported via a single `BackdropBlurFilter`
 * (pixi-filters) on `container` itself, not one per button — see the
 * constructor. Planning screen is always visible on its own — no header
 * trigger for it.
 */
export class HeaderBar {
  readonly container: Container;
  private readonly deps: HeaderBarDeps;

  private readonly homeButton: CircleButton;
  private readonly muteButton: CircleButton;
  private readonly startShowButton: PillButton;
  private readonly fpsPill: FpsPill;

  private muted = false;
  private fpsFrame = 0;
  /** Current width-ratio scale (see computeScale()) — set before the first element is built, so nothing is constructed at the wrong size and then immediately rebuilt. */
  private scale = 1;

  constructor(deps: HeaderBarDeps) {
    this.deps = deps;
    this.scale = this.computeScale(deps.app.screen.width);

    this.container = new Container();
    deps.app.stage.addChild(this.container);
    // One shared backdrop blur for the whole bar instead of one per button —
    // see createCircleButton()/createPillButton()'s own doc comments for why
    // the per-button filters were removed. `filterArea` is set/kept in sync
    // in the resize handler below (see layout()'s own doc comment for why a
    // fixed area matters).
    this.container.filters = [new BackdropBlurFilter({ strength: 6, quality: 4 })];

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
   * One glass circle (dark fill, soft white border) with a centered tinted
   * icon — home and mute share this exact look, sized at construction time
   * via applyCircleScale() and redrawn there again if the scale changes on
   * resize. The backdrop blur itself lives once on `this.container` (see
   * the constructor), not here.
   */
  private createCircleButton(iconName: IconName, ariaLabel: string): CircleButton {
    const root = new Container();
    root.label = ariaLabel;
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    root.addChild(bg);

    const icon = new Sprite(atlasTexture(iconName));
    icon.anchor.set(0.5);
    icon.tint = ICON_TINT;
    root.addChild(icon);

    const button: CircleButton = { root, bg, icon };
    this.applyCircleScale(button);
    return button;
  }

  /** Redraws a circle button's background/hitArea/icon size for the current `this.scale` — called once at creation and again from layout() whenever the scale changes. The hitArea only ever grows from BUTTON_HIT_SIZE, never shrinks below it, regardless of scale. */
  private applyCircleScale(button: CircleButton): void {
    const diameter = BUTTON_DIAMETER * this.scale;
    const hitSize = Math.max(BUTTON_HIT_SIZE, BUTTON_HIT_SIZE * this.scale);
    button.root.hitArea = new Rectangle(-hitSize / 2, -hitSize / 2, hitSize, hitSize);

    button.bg
      .clear()
      .circle(0, 0, diameter / 2)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });

    const iconSize = CIRCLE_ICON_SIZE * this.scale;
    button.icon.width = iconSize;
    button.icon.height = iconSize;
  }

  /**
   * The pill-shaped "ابدأ العرض" button: same glass look as the circles,
   * but its width tracks its own label's rendered size (the label swaps to
   * "بدأ العرض" after use, exactly like the old CSS version did) — see
   * layoutPill() for how the background/hitArea are recomputed whenever
   * that text changes. The backdrop blur itself lives once on
   * `this.container` (see the constructor), not here.
   */
  private createPillButton(iconName: IconName, text: string): PillButton {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    root.addChild(bg);

    const icon = new Sprite(atlasTexture(iconName));
    icon.anchor.set(0.5);
    icon.tint = ICON_TINT;
    root.addChild(icon);

    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: PILL_FONT_SIZE * this.scale,
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

  /**
   * Rebuilds a pill's background/hitArea/icon+label positions around however
   * wide its current label happens to render at `this.scale` — icon sits at
   * the pill's own right edge (RTL reading order), label extends left from
   * it, both centered vertically. Called at creation, on every start-show
   * text swap, and again from layout() whenever the scale changes. The
   * hitArea's height only ever grows from BUTTON_HIT_SIZE, never shrinks
   * below it, regardless of scale.
   */
  private layoutPill(button: PillButton, text: string): void {
    button.label.text = text;
    if (button.label.style.fontSize !== PILL_FONT_SIZE * this.scale) {
      button.label.style = new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: PILL_FONT_SIZE * this.scale,
        fontWeight: '500',
        fill: TEXT_FILL,
      });
    }
    const iconSize = PILL_ICON_SIZE * this.scale;
    button.icon.width = iconSize;
    button.icon.height = iconSize;

    const gap = PILL_GAP * this.scale;
    const paddingX = PILL_PADDING_X * this.scale;
    const contentWidth = button.icon.width + gap + button.label.width;
    const height = PILL_HEIGHT * this.scale;
    const width = contentWidth + paddingX * 2;
    const radius = height / 2;
    button.width = width;

    button.bg
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, radius)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });
    const hitHeight = Math.max(BUTTON_HIT_SIZE, height + 12 * this.scale);
    button.root.hitArea = new Rectangle(-width / 2, -hitHeight / 2, width, hitHeight);

    const iconX = width / 2 - paddingX - button.icon.width / 2;
    button.icon.position.set(iconX, 0);
    button.label.position.set(iconX - button.icon.width / 2 - gap - button.label.width, 0);
  }

  /**
   * The background is sized once here (per scale) from `FPS_WIDEST_READING`
   * ("120") and never redrawn again on a tick — `tickFps()` below only ever
   * mutates `label.text` (centered via `anchor.set(0.5)`, so it stays
   * visually centered inside this fixed pill regardless of digit count), no
   * `.clear()`/`.roundRect()` on every FPS-counter tick. `applyFpsScale()`
   * does redraw it, but only from layout() when the scale itself changes on
   * resize — not from the per-frame ticker.
   */
  private createFpsPill(): FpsPill {
    const root = new Container();

    const bg = new Graphics();
    root.addChild(bg);

    const style = new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: FPS_FONT_SIZE * this.scale,
      fill: 0xffffff,
      // Ported from the old CSS's `font-variant-numeric: tabular-nums` —
      // Pixi's TextStyle has no direct equivalent, so a monospace-ish
      // numeric family substitute isn't needed here since the digits in
      // this app's chosen font are already fixed-width; noted rather than
      // silently dropped.
    });
    const label = new Text({ text: FPS_WIDEST_READING, style });
    label.alpha = FPS_TEXT_ALPHA;
    label.anchor.set(0.5);
    root.addChild(label);

    const pill: FpsPill = { root, bg, label, width: 0 };
    this.applyFpsScale(pill);
    label.text = '60'; // actual starting display value; pill's own background size stays fixed regardless

    return pill;
  }

  /** Redraws the FPS pill's background/font size for the current `this.scale`, measuring against `FPS_WIDEST_READING` (not whatever digits are currently showing) so the width stays stable across every future tick. Called once at creation and again from layout() whenever the scale changes. */
  private applyFpsScale(pill: FpsPill): void {
    const currentText = pill.label.text;
    pill.label.style = new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: FPS_FONT_SIZE * this.scale,
      fill: 0xffffff,
    });
    pill.label.alpha = FPS_TEXT_ALPHA;
    pill.label.text = FPS_WIDEST_READING;

    const height = FPS_HEIGHT * this.scale;
    const paddingX = FPS_PADDING_X * this.scale;
    const width = pill.label.width + paddingX * 2;
    pill.width = width;
    pill.bg
      .clear()
      .roundRect(-width / 2, -height / 2, width, height, height / 2)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });

    pill.label.text = currentText;
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
    this.muteButton.icon.texture = atlasTexture(this.muted ? 'volumeX' : 'volume2');
  }

  /**
   * Only mutates the FPS label's text — the pill's own background is a
   * fixed size (see createFpsPill()) and every button's position only ever
   * depends on screen width (see layout()), so nothing here needs
   * redrawing or repositioning on every tick, just the digits themselves.
   */
  private tickFps = (): void => {
    this.fpsFrame++;
    if (this.fpsFrame % 15 === 0) {
      this.fpsPill.label.text = `${Math.round(this.deps.app.ticker.FPS)}`;
    }
  };

  /**
   * Width-ratio scale relative to REFERENCE_WIDTH, clamped to
   * [MIN_SCALE, MAX_SCALE] — the same "ratio of current screen width,
   * clamped" shape already used by HomeScreen.ts/TextComposer.ts elsewhere
   * in this app, applied here to element sizes (button diameter, padding,
   * icon/font size) instead of a max-width cap.
   */
  private computeScale(width: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, width / REFERENCE_WIDTH));
  }

  /**
   * Recomputes every element's position from the current screen size — same
   * formulas the original flex/padding CSS resolved to, worked out by hand
   * from measured geometry (see the module doc comment). Only ever called
   * from the constructor and the real `resize` event (see the constructor) —
   * nothing here depends on a per-frame value, so it never needs to run on
   * a ticker. Also keeps the shared backdrop-blur filter's `filterArea`
   * fixed to the current screen size instead of letting Pixi recompute it
   * from the container's own (otherwise static, but still not free to
   * re-derive) bounds every frame.
   *
   * If the screen width crosses into a different scale bracket, every
   * button/pill is redrawn at the new scale (applyCircleScale()/
   * layoutPill()/applyFpsScale()) before positions are recomputed — this
   * only runs on the real `resize` event, never per frame.
   */
  private layout(): void {
    const width = this.deps.app.screen.width;
    const nextScale = this.computeScale(width);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.applyCircleScale(this.homeButton);
      this.applyCircleScale(this.muteButton);
      this.layoutPill(this.startShowButton, this.startShowButton.label.text);
      this.applyFpsScale(this.fpsPill);
    }

    const paddingX = PADDING_X * this.scale;
    const rowCenterY = ROW_CENTER_Y * this.scale;
    const groupGap = GROUP_GAP * this.scale;
    const buttonDiameter = BUTTON_DIAMETER * this.scale;

    this.container.filterArea = new Rectangle(0, 0, width, HEADER_FILTER_HEIGHT * this.scale);

    this.muteButton.root.position.set(paddingX + buttonDiameter / 2, rowCenterY);
    const fpsLeftEdge = paddingX + buttonDiameter + groupGap;
    this.fpsPill.root.position.set(fpsLeftEdge + this.fpsPill.width / 2, rowCenterY);

    this.homeButton.root.position.set(width - paddingX - buttonDiameter / 2, rowCenterY);
    const startShowRightEdge = width - paddingX - buttonDiameter - groupGap;
    this.startShowButton.root.position.set(startShowRightEdge - this.startShowButton.width / 2, rowCenterY);
  }
}
