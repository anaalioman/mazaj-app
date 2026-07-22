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

// Reference geometry ported 1:1 from the old #mzj-header CSS rules at the
// mobile breakpoint (padding: 8px 10px; gap: 8px; buttons 36px circles).
// Every button/pill's Graphics/Text is built once at these exact sizes and
// never re-tessellated for a scale change — layout() scales each root
// Container via `.scale.set()` (a GPU transform) instead, the same
// width-ratio approach already used by HomeScreen.ts's NARROW_BREAKPOINT
// and TextComposer's COMPOSER_WIDTH_RATIO.
const PADDING_X = 10;
const ROW_CENTER_Y = 26;
const GROUP_GAP = 8;
const BUTTON_DIAMETER = 36;
const CIRCLE_ICON_SIZE = 18;
/** Real screen-pixel hit floor per finger — held fixed at this floor regardless of `this.scale`, only ever grows above it (see updateCircleHitArea()). */
const BUTTON_HIT_SIZE = 44;
const PILL_PADDING_X = 14;
const PILL_ICON_SIZE = 15;
const PILL_HEIGHT = 32;
const PILL_FONT_SIZE = 13;
const PILL_GAP = 6;
/** Real screen-pixel hit height for the start-show pill — fixed regardless of `this.scale` (see updatePillHitArea()), unlike the circle buttons' floor-then-grow behavior. */
const PILL_HIT_HEIGHT = 50;
/** Reference-unit hit-width floor for the start-show pill — its tap target never shrinks below this even when the label text is short ("بدأ العرض" is shorter than "ابدأ العرض"), only grows past it for a wider label. */
const PILL_MIN_HIT_WIDTH = 100;
const FPS_PADDING_X = 9;
const FPS_HEIGHT = 25;
const FPS_FONT_SIZE = 11;

// Width these reference px values were measured at (the app's own mobile
// breakpoint — see the comment above). Screen widths on either side scale
// every button/pill root by the same ratio, clamped so a very narrow or
// very wide device never balloons/shrinks past a usable range.
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
  /** Assigned to `root.hitArea` once at creation and mutated in place thereafter (see updateCircleHitArea()) — never reconstructed with `new`. */
  hitRect: Rectangle;
}

interface PillButton {
  root: Container;
  bg: Graphics;
  icon: Sprite;
  label: Text;
  /** Reference (unscaled) width — the real on-screen width is `width * this.scale`, since sizing now happens via `root.scale`, not by redrawing at a different width. */
  width: number;
  /** Assigned to `root.hitArea` once at creation and mutated in place thereafter (see updatePillHitArea()) — never reconstructed with `new`. */
  hitRect: Rectangle;
}

interface FpsPill {
  root: Container;
  bg: Graphics;
  label: Text;
  /** Reference (unscaled) width — the real on-screen width is `width * this.scale`. */
  width: number;
}

// Widest FPS reading this app will ever realistically display — sizes the
// pill's background once so it never has to be re-measured/redrawn as the
// live digit count changes (single-digit drops vs. steady 60/120).
const FPS_WIDEST_READING = '120';
// Header content height at reference scale (1) for the single shared
// backdrop-blur filter below — same reasoning as FireworksSystem.ts's own
// `layer.filterArea` doc comment: without a fixed area, a filtered
// container's processing region is recomputed from its own display-object
// bounds every frame. Scaled by `this.scale` in layout() along with
// everything else, and mirrored onto `filterMask` (see the constructor).
const HEADER_FILTER_HEIGHT = 60;

/**
 * Transparent horizontal bar: home + start-show (right), FPS + mute (left).
 * Fully PixiJS — no DOM/CSS anywhere in this component. Every visible piece
 * (glass-pill backgrounds, icons, text) is a `Graphics`/`Sprite`/`Text`
 * living in `container` on `app.stage`; the old CSS glass look (dark fill +
 * soft white border + backdrop blur) is ported via a single `BackdropBlurFilter`
 * (pixi-filters) on `container` itself, not one per button — see the
 * constructor. A rectangular `filterMask` clips the filter's processing
 * region to exactly the header's own bounds. Planning screen is always
 * visible on its own — no header trigger for it.
 */
export class HeaderBar {
  readonly container: Container;
  private readonly deps: HeaderBarDeps;
  /** Never added to the display tree — same convention as InputFieldView.ts's own mask. Redrawn every layout() call with the exact circle/pill shapes of every element at their current global position, so the shared blur filter's final compositing never touches a pixel outside those shapes (verified live: sparks passing through the gaps between buttons stay crisp). A precise compound shape like this can't be represented as a single scale/width/height transform the way one button's own bg can, so a redraw here is the correct mechanism, not a shortcut — same reasoning layoutPill() already uses for its own bg on a genuine content change. */
  private readonly filterMask: Graphics;
  /** Assigned to `container.filterArea` once in the constructor and mutated in place in layout() — never reconstructed with `new`. */
  private readonly filterAreaRect: Rectangle;

  private readonly homeButton: CircleButton;
  private readonly muteButton: CircleButton;
  private readonly startShowButton: PillButton;
  private readonly fpsPill: FpsPill;

  private muted = false;
  private fpsFrame = 0;
  /** Current width-ratio scale (see computeScale()) — set before the first element is built, so nothing is constructed at the wrong size and then immediately rescaled. */
  private scale = 1;

  constructor(deps: HeaderBarDeps) {
    this.deps = deps;
    this.scale = this.computeScale(deps.app.screen.width);

    this.container = new Container();
    deps.app.stage.addChild(this.container);
    // Sits above every other header element by z-order; only matters if the
    // container's own parent also has `sortableChildren` enabled (see this
    // property's own reasoning — that parent lives in fireworksMood.ts,
    // outside this file).
    this.container.zIndex = 9999;
    this.container.sortableChildren = true;
    // One shared backdrop blur for the whole bar instead of one per button —
    // see createCircleButton()/createPillButton()'s own doc comments for why
    // the per-button filters were removed. `filterArea`/`filterMask` are both
    // kept in sync in the resize handler below (see layout()'s own doc
    // comment for why a fixed area/mask matters).
    this.container.filters = [new BackdropBlurFilter({ strength: 6, quality: 4 })];
    this.filterMask = new Graphics();
    this.container.mask = this.filterMask;
    // filterArea only needs to be a bounding rectangle (PixiJS filters can't
    // sample a non-rectangular region) — the precise per-shape clipping
    // happens via `filterMask` above instead.
    this.filterAreaRect = new Rectangle();
    this.container.filterArea = this.filterAreaRect;

    this.homeButton = this.createCircleButton('home', 'العودة للقائمة الرئيسية');
    this.container.addChild(this.homeButton.root);
    this.wireTap(this.homeButton.root, () => this.deps.onBackToHome());

    this.startShowButton = this.createPillButton('play', 'ابدأ العرض');
    this.startShowButton.root.zIndex = 1000;
    this.container.addChild(this.startShowButton.root);
    // 'pointerdown' instead of 'pointertap' — fires on touch, not on
    // release, so starting the show doesn't wait for the finger to lift.
    this.wireTap(this.startShowButton.root, () => this.handleStartShow(), 'pointerdown');

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
   * icon — home and mute share this exact look. Drawn once at reference
   * size; resized later purely via `root.scale.set()` in layout(), never
   * redrawn.
   */
  private createCircleButton(iconName: IconName, ariaLabel: string): CircleButton {
    const root = new Container();
    root.label = ariaLabel;
    root.eventMode = 'static';
    root.cursor = 'pointer';

    const bg = new Graphics();
    bg.circle(0, 0, BUTTON_DIAMETER / 2).fill({ color: GLASS_FILL, alpha: GLASS_ALPHA }).stroke({
      width: 1,
      color: BORDER_COLOR,
      alpha: BORDER_ALPHA,
    });
    root.addChild(bg);

    const icon = new Sprite(atlasTexture(iconName));
    icon.anchor.set(0.5);
    icon.tint = ICON_TINT;
    icon.width = CIRCLE_ICON_SIZE;
    icon.height = CIRCLE_ICON_SIZE;
    root.addChild(icon);

    const hitRect = new Rectangle();
    root.hitArea = hitRect;
    const button: CircleButton = { root, bg, icon, hitRect };
    this.updateCircleHitArea(button);
    root.scale.set(this.scale);
    return button;
  }

  /** Keeps the circle's real screen-pixel hit square at BUTTON_HIT_SIZE minimum, growing past it with scale — computed in local (pre-transform) units and divided back out by `this.scale` so the *world-space* result comes out right once `root.scale` is applied on top. Mutates `button.hitRect` in place (already assigned to `root.hitArea` in createCircleButton()) rather than constructing a new Rectangle. Called once at creation and again from layout() whenever the scale changes; never touches `bg`. */
  private updateCircleHitArea(button: CircleButton): void {
    const worldHitSize = Math.max(BUTTON_HIT_SIZE, BUTTON_HIT_SIZE * this.scale);
    const localHitSize = worldHitSize / this.scale;
    button.hitRect.x = -localHitSize / 2;
    button.hitRect.y = -localHitSize / 2;
    button.hitRect.width = localHitSize;
    button.hitRect.height = localHitSize;
  }

  /**
   * The pill-shaped "ابدأ العرض" button: same glass look as the circles,
   * but its width tracks its own label's rendered size (the label swaps to
   * "بدأ العرض" after use, exactly like the old CSS version did) — see
   * layoutPill() for how the background/hitArea are recomputed whenever
   * that text changes. Resized for scale purely via `root.scale.set()` in
   * layout(), never by redrawing `bg` or touching the label's font size.
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
    icon.width = PILL_ICON_SIZE;
    icon.height = PILL_ICON_SIZE;
    root.addChild(icon);

    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: PILL_FONT_SIZE,
        fontWeight: '500',
        fill: TEXT_FILL,
      }),
    });
    label.anchor.set(0, 0.5);
    root.addChild(label);

    const hitRect = new Rectangle();
    root.hitArea = hitRect;
    const button: PillButton = { root, bg, icon, label, width: 0, hitRect };
    this.layoutPill(button, text);
    root.scale.set(this.scale);
    return button;
  }

  /**
   * Rebuilds a pill's background/hitArea/icon+label positions around
   * however wide its current label renders at the fixed reference font
   * size — icon sits at the pill's own right edge (RTL reading order),
   * label extends left from it, both centered vertically. Called at
   * creation and on every start-show text swap (a real content-width
   * change, so redrawing `bg` here is necessary) — never called just
   * because `this.scale` changed; see updatePillHitArea() for that case.
   */
  private layoutPill(button: PillButton, text: string): void {
    button.label.text = text;
    const contentWidth = button.icon.width + PILL_GAP + button.label.width;
    const width = contentWidth + PILL_PADDING_X * 2;
    const radius = PILL_HEIGHT / 2;
    button.width = width;

    button.bg
      .clear()
      .roundRect(-width / 2, -PILL_HEIGHT / 2, width, PILL_HEIGHT, radius)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });
    this.updatePillHitArea(button);

    const iconX = width / 2 - PILL_PADDING_X - button.icon.width / 2;
    button.icon.position.set(iconX, 0);
    button.label.position.set(iconX - button.icon.width / 2 - PILL_GAP - button.label.width, 0);
  }

  /** Fixes the pill's real screen-pixel hit height at PILL_HIT_HEIGHT regardless of `this.scale` — same local/world reasoning as updateCircleHitArea(). Hit width floors at PILL_MIN_HIT_WIDTH (reference units) so a short label ("بدأ العرض") doesn't shrink the tap target — only grows past that floor for a longer label. Mutates `button.hitRect` in place rather than constructing a new Rectangle. */
  private updatePillHitArea(button: PillButton): void {
    const localHitHeight = PILL_HIT_HEIGHT / this.scale;
    const hitWidth = Math.max(button.width, PILL_MIN_HIT_WIDTH);
    button.hitRect.x = -hitWidth / 2;
    button.hitRect.y = -localHitHeight / 2;
    button.hitRect.width = hitWidth;
    button.hitRect.height = localHitHeight;
  }

  /**
   * The background is sized once here from `FPS_WIDEST_READING` ("120") at
   * the fixed reference font size and never redrawn again — `tickFps()`
   * below only ever mutates `label.text` (centered via `anchor.set(0.5)`,
   * so it stays visually centered inside this fixed pill regardless of
   * digit count). Resized for scale purely via `root.scale.set()` in
   * layout().
   */
  private createFpsPill(): FpsPill {
    const root = new Container();

    const bg = new Graphics();
    root.addChild(bg);

    const style = new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: FPS_FONT_SIZE,
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

    const width = label.width + FPS_PADDING_X * 2;
    bg.roundRect(-width / 2, -FPS_HEIGHT / 2, width, FPS_HEIGHT, FPS_HEIGHT / 2)
      .fill({ color: GLASS_FILL, alpha: GLASS_ALPHA })
      .stroke({ width: 1, color: BORDER_COLOR, alpha: BORDER_ALPHA });

    label.text = '60'; // actual starting display value; pill's own background size stays fixed regardless

    root.scale.set(this.scale);
    return { root, bg, label, width };
  }

  /**
   * `pointertap` (a full press-release-in-place gesture, same as
   * ShapesPanel's own rows use) drives the actual action by default — a
   * button is a discrete action, not a drag. Passing `trigger: 'pointerdown'`
   * (used for the start-show button) fires the action on touch instead,
   * skipping the release step, for the one button where that immediacy
   * matters most. Either way, stopping propagation only on the trigger
   * event is not enough: `app.stage`'s own tap-to-fire listener in
   * fireworksMood.ts is wired to the raw `pointerdown`, which fires (and
   * bubbles all the way up to stage) well before `pointertap` is even
   * recognized on release — by then a rocket has already launched
   * underneath the button. Confirmed this by testing: 5 taps on the mute
   * button (which fires nothing) left visible rocket trails on screen,
   * compared to a clean zero-interaction baseline. So `pointerdown` itself
   * always gets its own `stopPropagation()`, independent of whether it's
   * also the trigger. Tactile feedback (cyan flash + click sound) replaces
   * the old DOM-delegated `attachTactileFeedback()` for this component
   * specifically, since that helper is CSS-class-based and this bar no
   * longer has any DOM to attach classes to.
   */
  private wireTap(target: Container, handler: () => void, trigger: 'pointertap' | 'pointerdown' = 'pointertap'): void {
    const fire = (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.deps.audio.playUiClick();
      this.flash(target);
      handler();
    };
    if (trigger === 'pointerdown') {
      target.on('pointerdown', fire);
    } else {
      target.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      target.on('pointertap', fire);
    }
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
   * in this app, applied here as a `Container.scale` transform on each
   * button/pill root instead of a max-width cap.
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
   * a ticker.
   *
   * If the screen width crosses into a different scale bracket, every
   * button/pill root is rescaled via `.scale.set()` (a GPU transform, not a
   * Graphics/Text redraw) and hitAreas are recomputed in local units so
   * their real on-screen size comes out right — this only runs on the real
   * `resize` event, never per frame.
   *
   * `filterAreaRect` (the filter's own bounding rectangle) and `filterMask`
   * (the precise per-shape clip — see its own doc comment) are both kept in
   * sync here too, from the same positions computed for the buttons/pills
   * themselves.
   */
  private layout(): void {
    const width = this.deps.app.screen.width;
    const nextScale = this.computeScale(width);
    if (nextScale !== this.scale) {
      this.scale = nextScale;
      this.homeButton.root.scale.set(this.scale);
      this.muteButton.root.scale.set(this.scale);
      this.startShowButton.root.scale.set(this.scale);
      this.fpsPill.root.scale.set(this.scale);
      this.updateCircleHitArea(this.homeButton);
      this.updateCircleHitArea(this.muteButton);
      this.updatePillHitArea(this.startShowButton);
    }

    const paddingX = PADDING_X * this.scale;
    const rowCenterY = ROW_CENTER_Y * this.scale;
    const groupGap = GROUP_GAP * this.scale;
    const buttonDiameter = BUTTON_DIAMETER * this.scale;
    const buttonRadius = buttonDiameter / 2;

    const muteX = paddingX + buttonRadius;
    this.muteButton.root.position.set(muteX, rowCenterY);

    const fpsVisualWidth = this.fpsPill.width * this.scale;
    const fpsLeftEdge = paddingX + buttonDiameter + groupGap;
    const fpsX = fpsLeftEdge + fpsVisualWidth / 2;
    this.fpsPill.root.position.set(fpsX, rowCenterY);

    const homeX = width - paddingX - buttonRadius;
    this.homeButton.root.position.set(homeX, rowCenterY);

    const startShowVisualWidth = this.startShowButton.width * this.scale;
    const startShowRightEdge = width - paddingX - buttonDiameter - groupGap;
    const startShowX = startShowRightEdge - startShowVisualWidth / 2;
    this.startShowButton.root.position.set(startShowX, rowCenterY);

    const filterHeight = HEADER_FILTER_HEIGHT * this.scale;
    this.filterAreaRect.width = width;
    this.filterAreaRect.height = filterHeight;

    const fpsVisualHeight = FPS_HEIGHT * this.scale;
    const startShowVisualHeight = PILL_HEIGHT * this.scale;
    const containerGlobal = this.container.getGlobalPosition();
    this.filterMask
      .clear()
      .circle(containerGlobal.x + muteX, containerGlobal.y + rowCenterY, buttonRadius)
      .circle(containerGlobal.x + homeX, containerGlobal.y + rowCenterY, buttonRadius)
      .roundRect(
        containerGlobal.x + fpsX - fpsVisualWidth / 2,
        containerGlobal.y + rowCenterY - fpsVisualHeight / 2,
        fpsVisualWidth,
        fpsVisualHeight,
        fpsVisualHeight / 2,
      )
      .roundRect(
        containerGlobal.x + startShowX - startShowVisualWidth / 2,
        containerGlobal.y + rowCenterY - startShowVisualHeight / 2,
        startShowVisualWidth,
        startShowVisualHeight,
        startShowVisualHeight / 2,
      )
      .fill(0xffffff);
  }
}
