import { Application, Container, FillGradient, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { AdvancedBloomFilter, DropShadowFilter } from 'pixi-filters';
import { iconTexture } from './svgIconTexture';
import { TextReveal, type TextRevealEffect } from '../effects/TextReveal';
import { TEXT_EFFECTS } from '../effects/textEffects/registry';
import type { AudioManager } from '../audio/AudioManager';
import { tickerSetInterval, tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';
import { createHiddenTextInput } from '../dom/shadowServices';

export type { TextRevealEffect };

export interface TextRevealConfig {
  text: string;
  effect: TextRevealEffect;
  x: number;
  y: number;
  fontScale: number;
  /** Radians, same convention as Pixi's own `rotation` (0 = upright, clockwise-positive). */
  rotation: number;
}

export interface TextComposerDeps {
  app: Application;
  audio: AudioManager;
  /** The committed text (`previewText`) is genuine scene content — it belongs in `worldContainer` so it's captured by snapshot/recording exactly like the rest of the show. See fireworksMood.ts's own container-tree doc comment. */
  worldContainer: Container;
  /** Everything else this class draws (the effects-bar chrome, the control box's border/handles, the tap-outside backdrop) is editing-time UI, not final art — it belongs in `uiContainer`. */
  uiContainer: Container;
  /** True while the input+effects bar OR the control box is open — lets the caller hide whatever else is on screen (e.g. the planning screen's own icon columns) so this stays the sole focus. */
  onComposingChange: (composing: boolean) => void;
}

/** One effects-bar item: a rounded preview frame (border+fill, gold identity, real bloom+shadow filters) plus its label below it. `border` is redrawn on select/deselect rather than rebuilt. */
interface EffectFrameObj {
  effect: TextRevealEffect;
  root: Container;
  border: Graphics;
  label: Text;
}

/**
 * The composer's own text field, root-centered like every other control in
 * this file: a background pill, a dimmed placeholder shown when empty, and
 * — inside `scrollGroup`, clipped by `mask` — the live typed text and its
 * blinking gold caret. `scrollGroup` is right-edge anchored (RTL: the first
 * typed character sits at the pill's right inner edge, later characters
 * extend left) and pans horizontally once the line outgrows the pill's own
 * width — see refreshInputVisual()'s own doc comment for why panning,
 * not shrinking or wrapping.
 */
interface InputFieldObj {
  root: Container;
  bg: Graphics;
  scrollGroup: Container;
  mask: Graphics;
  text: Text;
  placeholder: Text;
  cursor: Graphics;
}

const SAMPLE_PHRASE = 'مبروك';
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
/** Effects bar order/labels come straight from the registry — add an effect there and it shows up here automatically, no other change needed. */
const PREVIEW_ORDER: TextRevealEffect[] = TEXT_EFFECTS.map((entry) => entry.id);
/** Fixed demo word for every effects-bar preview — unrelated to the player's own text/the input's pre-filled default. */
const PREVIEW_PHRASE = 'مرحبا';
const PREVIEW_HOLD_BEFORE_MS = 600;
const PREVIEW_HOLD_AFTER_MS = 600;
const PREVIEW_NONE_HOLD_MS = 2000;

/** The box outline itself stays Konva.js's real Transformer border default (konva/src/shapes/Transformer.ts): borderStroke 'rgb(0, 161, 255)', borderStrokeWidth 1, no radius. */
const KONVA_BLUE = 0x00a1ff;
const BOX_BORDER_WIDTH = 1;
const BOX_PADDING = 14;

/**
 * Geometry ported 1:1 from the old `#mzj-text-composer`/`.mzj-text-composer-*`
 * CSS (measured directly off a live render, same methodology as every other
 * converted window) — a fixed-width panel pinned to the top-center of the
 * screen, an RTL topbar (back circle at the right, input filling the rest),
 * then a flex-wrap grid of effect frames that centers each row exactly the
 * way `flex-wrap: wrap; justify-content: center` used to.
 */
const COMPOSER_TOP_Y = 68;
const COMPOSER_MAX_WIDTH = 460;
const COMPOSER_WIDTH_RATIO = 0.94;
const BACK_DIAMETER = 34;
const GAP_BACK_INPUT = 8;
const TOPBAR_HEIGHT = 36;
const INPUT_HEIGHT = 36;
const EFFECTS_MARGIN_TOP = 10;
const PREVIEW_W = 78;
const PREVIEW_H = 44;
const PREVIEW_RADIUS = 10;
const ITEM_GAP_X = 14;
const ITEM_GAP_Y = 12;
const LABEL_GAP = 5;
const LABEL_FONT_SIZE = 10;
const LABEL_LINE_HEIGHT = 12;
const ITEM_HEIGHT = PREVIEW_H + LABEL_GAP + LABEL_LINE_HEIGHT;
/** Real Pixi hitArea per finger — same reasoning as every other control converted this session. Each item's own footprint (78x61) already clears the 44x44 floor. */
const FRAME_HIT_WIDTH = PREVIEW_W;
const FRAME_HIT_HEIGHT = ITEM_HEIGHT;
/** Root is centered on the *border box*, not the whole item — so the hitArea's vertical span is deliberately asymmetric (see buildEffectFrame()): it starts exactly at the box's own top edge (no wasted margin that would creep into the row above) and extends down through the label. */
const FRAME_HIT_TOP = -PREVIEW_H / 2;

/** The effects bar's unified gold identity — same color/filter recipe as the header and the planning screen's icon column, applied to every frame's border so the whole app reads as one visual language. */
const EFFECT_GOLD = 0xfff6df;
const FRAME_BORDER_IDLE_COLOR = 0xffffff;
const FRAME_BORDER_IDLE_ALPHA = 0.22;
const FRAME_BORDER_ACTIVE_ALPHA = 0.9;
const LABEL_IDLE_COLOR = 0xffffff;
const LABEL_IDLE_ALPHA = 0.65;
const LABEL_ACTIVE_COLOR = 0xffffff;

/** Plain glass chrome, matching HeaderBar's own back/home buttons — not part of the gold identity, which belongs to content (the effect frames), not navigation. */
const BACK_BG_COLOR = 0xffffff;
const BACK_BG_ALPHA = 0.06;
const BACK_ICON_TINT = 0xe5e7eb;
const BACK_ICON_SIZE = 18;
const BACK_ICON_SOURCE_SIZE = 40;

/**
 * The input field's genuine Pixi visuals — text, placeholder, and a
 * blinking gold caret, all real `Text`/`Graphics` on `app.stage`. See
 * buildGhostInput() for the hidden native `<input>` that feeds `this.text`
 * (and therefore this display) its characters via the OS's own keyboard.
 */
const INPUT_FONT_SIZE = 15;
const INPUT_TEXT_COLOR = 0xffe9b3;
/** Pointer movement (px) below which a press-and-release on the input pill still counts as a tap (opens the keyboard) rather than a pan. */
const INPUT_DRAG_TAP_TOLERANCE = 6;
const PLACEHOLDER_TEXT = 'اكتب عبارتك هنا';
const PLACEHOLDER_COLOR = 0xffffff;
const PLACEHOLDER_ALPHA = 0.4;
const CURSOR_WIDTH = 2;
const CURSOR_HEIGHT = 20;
const CURSOR_GAP = 3;
/** Standard OS caret blink interval (matches Chrome/Android's own ~530ms default). */
const CURSOR_BLINK_MS = 530;
/** The Pixi hitArea is deliberately taller than the visible 36px pill — same 44px-floor rule as every other tappable control this session. */
const INPUT_HIT_HEIGHT = 44;

function effectFrameFilters(): (AdvancedBloomFilter | DropShadowFilter)[] {
  return [
    new AdvancedBloomFilter({ threshold: 0.3, blur: 3, quality: 4, bloomScale: 1.1, brightness: 1.05 }),
    new DropShadowFilter({ color: 0x000000, alpha: 0.45, blur: 2, offset: { x: 0, y: 2 } }),
  ];
}

/**
 * Two dedicated corner handles replace both the old 4-identical-corners
 * grid and the separate rotate stalk+handle that used to stick out above
 * the box: top-right (`ne`) rotates, bottom-right (`se`) resizes. Nothing
 * ever renders outside the box's own rectangle anymore.
 */
const HANDLE_VISUAL_DIAMETER = 24;
const HANDLE_FILL = 0xfff6df;
const HANDLE_STROKE = 0xc98f34;
const HANDLE_STROKE_WIDTH = 2;
/** Explicit oversized Pixi hitArea per finger — the circle stays 24px, the tappable area is still a generous 44x44 for accurate mobile touch. */
const HANDLE_HIT_SIZE = 44;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Free-text composing flow for the "T" icon: a live top input + an effects
 * bar (each icon auto-loops its own demo continuously — no tap needed to
 * preview, a tap only confirms that effect), a back arrow that closes all of
 * that and reveals the player's real text in a draggable + pinch-resizable
 * + rotatable control box, and tapping outside commits it (bare text, no
 * chrome) at whatever position/scale/rotation was left. Tapping the
 * committed text later reopens this whole flow pre-filled. Position/scale/
 * rotation persist in memory for as long as the mood instance lives (see
 * fireworksMood.ts's module doc).
 *
 * Every visible pixel of this class is genuine Pixi: the back button, the
 * input field (background pill, live text, placeholder, blinking gold
 * caret, the horizontal-scroll mask/pan from refreshInputVisual()), the
 * effects bar's 7 frames, the control box (border + two dedicated corner
 * handles), and the full-screen "tap outside to commit" backdrop are all
 * `Graphics`/`Container`/`Text` objects living on `app.stage`, positioned
 * via Pixi's own `position`/`rotation` — never CSS, never DOM.
 *
 * Typing itself is the one deliberate exception: `ghostInput` (see
 * buildGhostInput()) is a real `<input>` element, invisible and positioned
 * exactly over the Pixi input pill, focused on tap so the device's own OS
 * keyboard opens — autocorrect, predictive text, voice input, and every
 * other native typing feature the platform provides work exactly as they
 * would in any other app. Its `input` event is the only bridge into Pixi:
 * `this.text = ghostInput.value` feeds the same `refreshInputVisual()`
 * pipeline a native-canvas keyboard would have. This is a real, explicit
 * architectural trade against an earlier revision of this class, which had
 * zero DOM at the cost of every one of those OS features — see
 * buildGhostInput()'s own doc comment for the reasoning.
 *
 * The control box border keeps Konva.js's own Transformer border default
 * (1px `rgb(0, 161, 255)`, see the KONVA_BLUE constant); the two handles
 * are their own dedicated multi-function circles, not a generic 4-corner
 * grid — nothing renders outside the box's own rectangle (see HANDLE_*
 * constants above and syncControlBoxTransform() below).
 *
 * The effects bar's demo previews reuse the exact same TextReveal engine as
 * the real final reveal (same particle physics, no CSS/static-image
 * stand-in) via a dedicated instance, cycling through smoke/flame/none one
 * at a time (never more than one running at once, a sequential loop rather
 * than 7 simultaneous animations, for performance) for as long as the input
 * row is open. `previewMask` clips whichever frame is currently animating to
 * that frame's own Pixi-computed rectangle, so particles never spill past a
 * frame's rounded border — the same mask is reused for every frame in turn
 * since only one is ever live at once.
 */
export class TextComposer {
  private readonly deps: TextComposerDeps;
  private readonly composerContainer: Container;
  /** Swallows taps that land in the gaps between buttons/frames — see the constructor's doc comment where it's built. */
  private readonly catchAll: Graphics;
  private readonly backButton: { root: Container; bg: Graphics };
  private readonly inputField: InputFieldObj;
  private readonly effectFrames: EffectFrameObj[];
  /** The one real DOM element in this class — see buildGhostInput()'s own doc comment. */
  private readonly ghostInput: HTMLInputElement;
  /** Set each time layoutComposer() runs — the input pill's own available width, used by refreshInputVisual()'s auto-scroll. */
  private inputFieldWidth = 0;
  /** Current pan offset applied to inputField.scrollGroup — 0 is fully right-aligned (resting position); positive values shift the group right, revealing more of the line's left (most-recently-typed) end. Clamped to [0, inputMaxScrollX]. */
  private inputScrollX = 0;
  /** How far inputScrollX can go — 0 once the line fits the pill outright; recomputed every refreshInputVisual() call. */
  private inputMaxScrollX = 0;
  private inputDragPointerId: number | null = null;
  private inputDragStartX = 0;
  private inputDragStartScrollX = 0;
  private inputDragMoved = false;
  private cursorBlinkTimer: TickerTimerHandle | undefined;
  private readonly previewText: Text;
  private readonly baseFontSize: number;
  private readonly previewReveal: TextReveal;
  /** Clips the preview reveal's text+particles to the current icon slot's rectangle — nothing may render outside it, however the particles naturally move. */
  private readonly previewMask: Graphics;

  /** Full-screen, invisible-but-hit-testable — catches "tap outside the box" to commit. Sits directly under `controlBox` on the stage so the box/handles always win the hit test over it. */
  private readonly backdrop: Graphics;
  /** Everything the player drags/pinches/rotates: positioned at (posX, posY) and rotated by `this.rotation` as one unit, which is why every child below is drawn centered on its own local origin. */
  private readonly controlBox: Container;
  private readonly boxBorder: Graphics;
  /** Top-right corner: rotation only. `.glow` is the soft additive halo behind the mark, hidden until pressed — see createHandle()'s doc comment for why that halo has to exist as its own shape. */
  private readonly rotateHandle: { root: Container; glow: Graphics };
  /** Bottom-right corner: resize/scale only. */
  private readonly resizeHandle: { root: Container; glow: Graphics };

  private text = SAMPLE_PHRASE;
  private effect: TextRevealEffect = 'none';
  private posX: number;
  private posY: number;
  private scale = 1;
  /** Radians — see TextRevealConfig's doc comment for the convention. */
  private rotation = 0;
  private hasCommittedOnce = false;

  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number } | null = null;
  private pinchStartDist: number | null = null;
  private pinchStartScale = 1;

  /** Single-finger corner-handle resize, independent of (and mutually exclusive with) the two-finger pinch above — both stay equally capable ways to resize. */
  private activeHandlePointerId: number | null = null;
  private handleStartDist = 0;
  private handleStartScale = 1;

  /** Single-finger rotation via the dedicated handle above the box — stores the angle offset at drag-start so the handle tracks the finger exactly regardless of the box's current tilt. */
  private activeRotatePointerId: number | null = null;
  private rotateStartAngleOffset = 0;

  private previewCycleActive = false;
  private previewGeneration = 0;
  private previewIndex = 0;
  private previewCycleTimer: TickerTimerHandle | undefined;

  constructor(deps: TextComposerDeps) {
    this.deps = deps;

    const { width, height } = deps.app.screen;
    this.posX = width / 2;
    this.posY = height / 2;
    this.baseFontSize = Math.max(36, Math.min(width, height) * 0.09);

    this.previewReveal = new TextReveal(deps.app);
    // TextReveal's own constructor always self-parents to app.stage — reparent
    // into uiContainer since this specific instance only ever plays the
    // effects-bar's demo preview (editing-time UI, not final art). Contrast
    // with fireworksMood.ts's own separate TextReveal instance for the real
    // committed reveal, which stays in worldContainer.
    deps.uiContainer.addChild(this.previewReveal.container);
    deps.app.ticker.add((ticker) => this.previewReveal.update(ticker.deltaTime));

    // Not added to the stage — Graphics used purely as a mask don't need to
    // be part of the render tree, only assigned via `.mask`.
    this.previewMask = new Graphics();
    this.previewReveal.container.mask = this.previewMask;

    this.previewText = new Text({ text: this.text, style: this.textStyle() });
    this.previewText.anchor.set(0.5);
    this.previewText.visible = false;
    this.previewText.eventMode = 'static';
    this.previewText.cursor = 'pointer';
    this.previewText.on('pointerdown', (event) => {
      event.stopPropagation();
      this.open();
    });
    deps.worldContainer.addChild(this.previewText);
    this.syncPreviewTransform();

    this.composerContainer = new Container();
    this.composerContainer.visible = false;
    deps.uiContainer.addChild(this.composerContainer);

    // A silent catch-all sitting behind every other child: individual
    // buttons/frames only claim their own hitArea, so the *gaps* between
    // them (the row/column gaps, the space below the last row) belong to
    // nobody and would otherwise fall straight through to app.stage's
    // tap-to-fire rocket listener underneath — the old DOM `#mzj-text-composer`
    // div never had this problem since a block-level element absorbs every
    // tap inside its own box by default. This replicates that: real drawn
    // geometry (Pixi hit-tests a Graphics against its own shape when no
    // explicit hitArea is set), sized to the composer's full content box in
    // layoutComposer()/layoutEffectFrames(), doing nothing but swallowing
    // the tap.
    this.catchAll = new Graphics();
    this.catchAll.eventMode = 'static';
    this.catchAll.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.composerContainer.addChild(this.catchAll);

    this.inputField = this.buildInputField();
    this.composerContainer.addChild(this.inputField.root);

    this.backButton = this.buildBackButton();
    this.composerContainer.addChild(this.backButton.root);

    this.effectFrames = TEXT_EFFECTS.map((entry) => this.buildEffectFrame(entry.id, entry.label));
    for (const frame of this.effectFrames) this.composerContainer.addChild(frame.root);

    this.ghostInput = this.buildGhostInput();

    deps.app.renderer.on('resize', () => this.layoutComposer());
    this.layoutComposer();
    this.refreshInputVisual();

    // Full-screen hit target for "tap outside the box commits it" — a
    // near-zero-alpha fill so it's still real drawn geometry (Pixi hit-tests
    // a Graphics against its own shape when no explicit `hitArea` is set),
    // matching how `app.stage.hitArea` itself is kept in sync on resize
    // (see fireworksMood.ts).
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.001 });
    this.backdrop.eventMode = 'static';
    this.backdrop.visible = false;
    this.backdrop.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.commit();
    });
    deps.uiContainer.addChild(this.backdrop);
    deps.app.renderer.on('resize', () => {
      const screen = deps.app.screen;
      this.backdrop.clear().rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.001 });
    });

    this.controlBox = new Container();
    this.controlBox.visible = false;
    deps.uiContainer.addChild(this.controlBox);

    this.boxBorder = new Graphics();
    this.boxBorder.eventMode = 'static';
    this.boxBorder.cursor = 'grab';
    this.controlBox.addChild(this.boxBorder);

    this.rotateHandle = this.createHandle('crosshair');
    this.controlBox.addChild(this.rotateHandle.root);

    this.resizeHandle = this.createHandle('nwse-resize');
    this.controlBox.addChild(this.resizeHandle.root);

    this.wireEffectButtons();
    this.wireBack();
    this.wireControlBox();

    deps.app.stage.on('pointermove', this.handleInputPointerMove);
    deps.app.stage.on('pointerup', this.handleInputPointerEnd);
    deps.app.stage.on('pointerupoutside', this.handleInputPointerEnd);
  }

  /**
   * One 24px gold circle with a real drop shadow, plus a separate soft
   * additive "glow" halo behind it that stays hidden until pressed. The
   * halo has to be its own shape, not just `blendMode = 'add'` on the mark
   * itself: additive blending only brightens where it overlaps *something*
   * underneath, and against this app's plain black sky an opaque circle has
   * nothing to add to — it renders pixel-identical in 'add' and 'normal'.
   * The halo is several concentric, alpha-fading circles (the exact
   * layering technique `textures.ts`'s own particle texture already uses)
   * so additive blending has translucent content to actually bloom against.
   * Both handles (rotate + resize) share this exact look — only their
   * position and the gesture wired to them differ.
   */
  private createHandle(cursor: string): { root: Container; glow: Graphics } {
    const root = new Container();

    const glow = new Graphics();
    const glowSteps = 5;
    const glowRadius = HANDLE_VISUAL_DIAMETER * 1.5;
    for (let i = glowSteps; i > 0; i--) {
      const t = i / glowSteps;
      glow.circle(0, 0, glowRadius * t).fill({ color: HANDLE_FILL, alpha: (1 - t) * 0.6 });
    }
    glow.blendMode = 'add';
    glow.visible = false;
    glow.eventMode = 'none';
    root.addChild(glow);

    const mark = new Graphics();
    mark.circle(0, 0, HANDLE_VISUAL_DIAMETER / 2).fill(HANDLE_FILL).stroke({ width: HANDLE_STROKE_WIDTH, color: HANDLE_STROKE });
    mark.filters = [new DropShadowFilter({ color: 0x000000, alpha: 0.45, blur: 2, offset: { x: 0, y: 2 } })];
    root.addChild(mark);

    root.eventMode = 'static';
    root.cursor = cursor;
    root.hitArea = new Rectangle(-HANDLE_HIT_SIZE / 2, -HANDLE_HIT_SIZE / 2, HANDLE_HIT_SIZE, HANDLE_HIT_SIZE);
    return { root, glow };
  }

  /** Opens the composer pre-filled with whatever text/effect is currently set — used by the T icon and by tapping the committed text. Starts on the effects bar; the OS keyboard only opens once the player actually taps the input pill (see buildGhostInput()), not automatically here. */
  open(): void {
    this.closeControlBox();
    this.previewText.visible = false;
    this.refreshInputVisual();
    this.syncEffectFrames();
    this.composerContainer.visible = true;
    this.deps.onComposingChange(true);
    this.startPreviewCycle();
  }

  /**
   * Returns the config beginShow() should reveal with, and hides the static
   * preview so the real animated reveal can take over without the two
   * overlapping. Null if the player never actually went through the
   * composer at all this session — callers should fall back to their own
   * default in that case.
   */
  consumeForReveal(): TextRevealConfig | null {
    // Defensive: the show can start (via the header's always-available
    // "ابدأ العرض") while the composer or control box is still open.
    this.stopPreviewCycle();
    this.composerContainer.visible = false;
    this.ghostInput.blur();
    this.closeControlBox();
    this.previewText.visible = false;
    if (!this.hasCommittedOnce) return null;
    return { text: this.text, effect: this.effect, x: this.posX, y: this.posY, fontScale: this.scale, rotation: this.rotation };
  }

  private textStyle(): TextStyle {
    return new TextStyle({
      fontFamily: 'system-ui, "Segoe UI", Tahoma, sans-serif',
      fontSize: Math.round(this.baseFontSize * this.scale),
      fontWeight: '800',
      fill: 0xffe9b3,
      stroke: { color: 0x2a1400, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3 },
      align: 'center',
    });
  }

  private wireEffectButtons(): void {
    for (const frame of this.effectFrames) {
      frame.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      frame.root.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.deps.audio.playUiClick();
        this.effect = frame.effect;
        this.syncEffectFrames();
      });
    }
  }

  /**
   * Soft-depth flat design: a subtle top-to-bottom gradient fill (suggests
   * a light source from above, the same cue neumorphism reaches for) plus
   * a faint inner top highlight band — kept deliberately understated rather
   * than true neumorphism's near-equal-luminosity background+shape, which
   * has well-documented contrast/accessibility problems for anything that
   * needs to read as clearly tappable. The active state stays high-contrast
   * (solid gold stroke + brighter fill + a slight scale lift) precisely
   * because legibility of "which effect is selected" matters more than
   * aesthetic purity here.
   */
  private syncEffectFrames(): void {
    for (const frame of this.effectFrames) {
      const active = frame.effect === this.effect;
      const fill = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        textureSpace: 'local',
        colorStops: active
          ? [{ offset: 0, color: 0x2c2410 }, { offset: 1, color: 0x0c0a04 }]
          : [{ offset: 0, color: 0x171922 }, { offset: 1, color: 0x08090d }],
      });
      frame.border
        .clear()
        .roundRect(-PREVIEW_W / 2, -PREVIEW_H / 2, PREVIEW_W, PREVIEW_H, PREVIEW_RADIUS)
        .fill(fill)
        .stroke({
          width: 1.5,
          color: active ? EFFECT_GOLD : FRAME_BORDER_IDLE_COLOR,
          alpha: active ? FRAME_BORDER_ACTIVE_ALPHA : FRAME_BORDER_IDLE_ALPHA,
        })
        .roundRect(-PREVIEW_W / 2 + 3, -PREVIEW_H / 2 + 3, PREVIEW_W - 6, PREVIEW_H * 0.42, PREVIEW_RADIUS - 3)
        .fill({ color: 0xffffff, alpha: active ? 0.1 : 0.05 });
      frame.root.scale.set(active ? 1.05 : 1);
      frame.label.style = new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: LABEL_FONT_SIZE,
        fontWeight: active ? '700' : '400',
        fill: active ? LABEL_ACTIVE_COLOR : LABEL_IDLE_COLOR,
      });
      frame.label.alpha = active ? 1 : LABEL_IDLE_ALPHA;
    }
  }

  private wireBack(): void {
    this.backButton.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.backButton.root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.deps.audio.playUiClick();
      this.stopPreviewCycle();
      this.ghostInput.blur();
      this.composerContainer.visible = false;
      this.text = this.text.trim() ? this.text : SAMPLE_PHRASE;
      this.previewText.text = this.text;
      this.previewText.visible = true;
      this.syncPreviewTransform();
      this.openControlBox();
    });
  }

  /** Runs smoke -> flame -> none -> smoke -> ... forever, one at a time, using the exact same TextReveal engine as the real final reveal — only ever one preview actually animating. Independent of tapping an icon to select it. */
  private startPreviewCycle(): void {
    if (this.previewCycleActive) return;
    this.previewCycleActive = true;
    this.previewGeneration++;
    void this.runPreviewStep(this.previewGeneration);
  }

  private stopPreviewCycle(): void {
    this.previewCycleActive = false;
    this.previewGeneration++;
    this.previewCycleTimer?.cancel();
    this.previewReveal.clear();
  }

  /**
   * Per frame: show "مرحبا" plainly and statically first, hold briefly so
   * it's clearly read, then (for smoke/flame/...) run the real dissolve over
   * it — the exact same TextReveal engine as the final reveal, clipped via
   * `previewMask` to this frame's own Pixi-computed rectangle (`getGlobalPosition()`
   * plus the fixed PREVIEW_W/PREVIEW_H — every frame is drawn at that exact
   * size, see buildEffectFrame()) so nothing ever escapes it. One frame
   * animates at a time — a sequential loop, not 7 concurrent particle
   * systems — for performance. 'none' just holds the static word for a
   * comparable beat, since it has no effect to demonstrate. Advances to the
   * next frame once done, looping forever.
   */
  private async runPreviewStep(generation: number): Promise<void> {
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    const effect = PREVIEW_ORDER[this.previewIndex];
    const frame = this.effectFrames.find((f) => f.effect === effect)!;
    const { x, y } = frame.root.getGlobalPosition();
    const fontScale = (PREVIEW_H * 0.4) / this.baseFontSize;

    this.previewMask.clear().rect(x - PREVIEW_W / 2, y - PREVIEW_H / 2, PREVIEW_W, PREVIEW_H).fill(0xffffff);

    // Static, clearly-readable "مرحبا" first — no effect yet.
    await this.previewReveal.reveal(PREVIEW_PHRASE, { effect: 'none', x, y, fontScale });
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    if (effect === 'none') {
      await this.previewWait(PREVIEW_NONE_HOLD_MS);
    } else {
      await this.previewWait(PREVIEW_HOLD_BEFORE_MS);
      if (!this.previewCycleActive || generation !== this.previewGeneration) return;
      // Now the real dissolve passes over the already-visible word.
      await this.previewReveal.reveal(PREVIEW_PHRASE, { effect, x, y, fontScale });
      if (!this.previewCycleActive || generation !== this.previewGeneration) return;
      await this.previewWait(PREVIEW_HOLD_AFTER_MS);
    }
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    this.previewIndex = (this.previewIndex + 1) % PREVIEW_ORDER.length;
    void this.runPreviewStep(generation);
  }

  private previewWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.previewCycleTimer = tickerSetTimeout(this.deps.app.ticker, resolve, ms);
    });
  }

  private openControlBox(): void {
    this.backdrop.visible = true;
    this.controlBox.visible = true;
    this.syncControlBoxTransform();
    this.deps.onComposingChange(true);
  }

  private closeControlBox(): void {
    this.backdrop.visible = false;
    this.controlBox.visible = false;
    this.activePointers.clear();
    this.dragStart = null;
    this.pinchStartDist = null;
    this.activeHandlePointerId = null;
    this.resizeHandle.glow.visible = false;
    this.activeRotatePointerId = null;
    this.rotateHandle.glow.visible = false;
  }

  /** Tapping the backdrop outside the box commits it: chrome disappears, bare text stays at its last position/scale. */
  private commit(): void {
    this.closeControlBox();
    this.hasCommittedOnce = true;
    this.deps.onComposingChange(false);
  }

  /**
   * Every drag/resize/rotate gesture starts on a specific Pixi object's own
   * `pointerdown` (the box border, a corner handle, or the rotate handle),
   * but `pointermove`/`pointerup` are wired once here on `app.stage` — the
   * same idiom PlanningMode.ts already uses elsewhere in this app for its
   * own pin-dragging, and the standard Pixi pattern for "keep tracking a
   * finger even once it slides off the small object that grabbed it"
   * (there's no DOM-style `setPointerCapture` for a Pixi DisplayObject).
   * `event.stopPropagation()` on every `pointerdown` below matters for a
   * different reason than it did as CSS: without it, the same tap would
   * also bubble up to `app.stage`'s own tap-to-fire listener in
   * fireworksMood.ts and launch a rocket underneath the box.
   */
  private wireControlBox(): void {
    this.boxBorder.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activePointers.set(event.pointerId, { x, y });

      if (this.activePointers.size === 1) {
        this.dragStart = { x: x - this.posX, y: y - this.posY };
      } else if (this.activePointers.size === 2) {
        const [a, b] = Array.from(this.activePointers.values());
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchStartScale = this.scale;
      }
    });

    this.wireResizeHandle();
    this.wireRotateHandle();

    this.deps.app.stage.on('pointermove', this.handleControlPointerMove);
    this.deps.app.stage.on('pointerup', this.handleControlPointerEnd);
    this.deps.app.stage.on('pointerupoutside', this.handleControlPointerEnd);
  }

  private handleControlPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.controlBox.visible) return;
    const { x, y } = event.global;

    if (event.pointerId === this.activeRotatePointerId) {
      const angle = Math.atan2(y - this.posY, x - this.posX);
      this.rotation = angle + this.rotateStartAngleOffset;
      this.syncPreviewTransform();
      this.syncControlBoxTransform();
      return;
    }

    if (event.pointerId === this.activeHandlePointerId) {
      const dist = Math.hypot(x - this.posX, y - this.posY);
      this.scale = clamp(this.handleStartScale * (dist / this.handleStartDist), MIN_SCALE, MAX_SCALE);
      this.syncPreviewTransform();
      this.syncControlBoxTransform();
      return;
    }

    if (!this.activePointers.has(event.pointerId)) return;
    this.activePointers.set(event.pointerId, { x, y });

    if (this.activePointers.size >= 2 && this.pinchStartDist !== null) {
      const [a, b] = Array.from(this.activePointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.scale = clamp(this.pinchStartScale * (dist / this.pinchStartDist), MIN_SCALE, MAX_SCALE);
      this.syncPreviewTransform();
      this.syncControlBoxTransform();
    } else if (this.activePointers.size === 1 && this.dragStart) {
      this.posX = x - this.dragStart.x;
      this.posY = y - this.dragStart.y;
      this.syncPreviewTransform();
      this.syncControlBoxTransform();
    }
  };

  private handleControlPointerEnd = (event: FederatedPointerEvent): void => {
    if (event.pointerId === this.activeRotatePointerId) {
      this.activeRotatePointerId = null;
      this.rotateHandle.glow.visible = false;
      return;
    }
    if (event.pointerId === this.activeHandlePointerId) {
      this.activeHandlePointerId = null;
      this.resizeHandle.glow.visible = false;
      return;
    }
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) this.pinchStartDist = null;
    if (this.activePointers.size < 1) this.dragStart = null;
  };

  /**
   * The bottom-right handle only — equally capable as the two-finger pinch
   * above, not a fallback for it. Dragging it measures its distance from
   * the box's center and scales relative to where the drag started, exactly
   * like pinch does with two points instead of one. Showing its `.glow`
   * (additive-blended) while held is the touch feedback, the same
   * overlapping-additive-brightness technique every spark/rocket in
   * FireworksSystem.ts already uses for its own glow.
   */
  private wireResizeHandle(): void {
    this.resizeHandle.root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activeHandlePointerId = event.pointerId;
      this.handleStartDist = Math.max(1, Math.hypot(x - this.posX, y - this.posY));
      this.handleStartScale = this.scale;
      this.resizeHandle.glow.visible = true;
    });
  }

  /**
   * The top-right handle: Pixi's own `controlBox.rotation` already carries
   * it around the box's center as the player turns the text, so this only
   * wires "finger angle around the center -> new rotation". On grab it
   * records the offset between the pointer's current angle (relative to
   * `posX/posY`, in stage space, independent of the box's own current
   * rotation) and the current rotation, then every move just re-applies
   * that same offset to wherever the finger now is — so the handle tracks
   * the finger exactly, a full 360° free turn.
   */
  private wireRotateHandle(): void {
    this.rotateHandle.root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activeRotatePointerId = event.pointerId;
      const angle = Math.atan2(y - this.posY, x - this.posX);
      this.rotateStartAngleOffset = this.rotation - angle;
      this.rotateHandle.glow.visible = true;
    });
  }

  private syncPreviewTransform(): void {
    this.previewText.position.set(this.posX, this.posY);
    this.previewText.rotation = this.rotation;
    this.previewText.style = this.textStyle();
  }

  /**
   * Sized from the text's own *local* (unrotated) width/height — not
   * `getBounds()`, which returns the rotated stage-space AABB and would
   * make the box balloon out as soon as the text tilts. `controlBox` is
   * positioned at (posX, posY) and rotated by `this.rotation` as one unit
   * via Pixi's own `position`/`rotation` (never CSS), which is why the
   * border and both handles below are drawn/positioned centered on local
   * (0, 0) — the container's own transform carries all of them around
   * together. Nothing is ever positioned outside the box's own rectangle:
   * the rotate handle sits exactly on the top-right corner, the resize
   * handle exactly on the bottom-right corner, no stalk sticking out above.
   */
  private syncControlBoxTransform(): void {
    const width = this.previewText.width + BOX_PADDING * 2;
    const height = this.previewText.height + BOX_PADDING * 2;
    const hw = width / 2;
    const hh = height / 2;

    this.boxBorder
      .clear()
      .rect(-hw, -hh, width, height)
      .fill({ color: 0x000000, alpha: 0.001 })
      .stroke({ width: BOX_BORDER_WIDTH, color: KONVA_BLUE });

    this.rotateHandle.root.position.set(hw, -hh);
    this.resizeHandle.root.position.set(hw, hh);

    this.controlBox.position.set(this.posX, this.posY);
    this.controlBox.rotation = this.rotation;
  }

  /**
   * The text field itself: a glass pill (background matches the old
   * `.mzj-text-composer-input`'s `rgba(255,255,255,0.08)`), the live typed
   * text (gold `#ffe9b3`, same as before), a dimmed placeholder shown only
   * while empty, and a blinking gold caret with the same
   * `AdvancedBloomFilter`/`DropShadowFilter` recipe as the effects bar's
   * frames — "مؤشر ذهبي متسق مع الهوية الملكية". Tapping anywhere in the
   * field's hitArea focuses `ghostInput` (see buildGhostInput()), which
   * opens the device's own OS keyboard; a drag instead pans a long line to
   * review it (see handleInputPointerMove()).
   * `hitArea`/`bg` are sized in layoutComposer() once the pill's width is
   * known; everything here is built root-centered on local (0, 0), same
   * convention as every other control in this file.
   */
  private buildInputField(): InputFieldObj {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'text';

    const bg = new Graphics();
    root.addChild(bg);

    const placeholder = new Text({
      text: PLACEHOLDER_TEXT,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: INPUT_FONT_SIZE, fontWeight: '700', fill: PLACEHOLDER_COLOR }),
    });
    placeholder.anchor.set(0.5);
    placeholder.alpha = PLACEHOLDER_ALPHA;
    root.addChild(placeholder);

    // Never added to the display tree — a Pixi mask doesn't need to be, it
    // only needs to be assigned to `scrollGroup.mask` below. Drawn to its
    // real size once the pill's width is known, in layoutComposer().
    const mask = new Graphics();

    // Right-edge anchored (RTL: the first typed character's own edge sits
    // fixed at the pill's right inner edge; the line grows leftward,
    // unbounded, as more is typed) and clipped by `mask` — panned via
    // refreshInputVisual()'s inputScrollX once the line outgrows the pill.
    const scrollGroup = new Container();
    scrollGroup.mask = mask;
    root.addChild(scrollGroup);

    const text = new Text({
      text: '',
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: INPUT_FONT_SIZE, fontWeight: '700', fill: INPUT_TEXT_COLOR }),
    });
    text.anchor.set(1, 0.5);
    scrollGroup.addChild(text);

    const cursor = new Graphics().rect(-CURSOR_WIDTH / 2, -CURSOR_HEIGHT / 2, CURSOR_WIDTH, CURSOR_HEIGHT).fill(EFFECT_GOLD);
    cursor.filters = effectFrameFilters();
    cursor.visible = false;
    scrollGroup.addChild(cursor);

    root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.inputDragPointerId = event.pointerId;
      this.inputDragStartX = event.global.x;
      this.inputDragStartScrollX = this.inputScrollX;
      this.inputDragMoved = false;
    });
    root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      // A real pan (see handleInputPointerMove) already did its job; a tap
      // that barely moved still focuses the ghost input (raising the OS
      // keyboard), same as before panning existed at all.
      if (this.inputDragMoved) return;
      this.ghostInput.focus();
    });

    return { root, bg, scrollGroup, mask, text, placeholder, cursor };
  }

  /**
   * Touch-panning for the input line — "التحكم بالإصبع" alongside the
   * auto-scroll refreshInputVisual() already does while typing. Registered
   * once, globally, same pattern as wireControlBox()'s own stage-level
   * pointermove/pointerup pair right below it; both gate themselves on
   * their own piece of state so they never interfere with each other.
   */
  private handleInputPointerMove = (event: FederatedPointerEvent): void => {
    if (this.inputDragPointerId === null || event.pointerId !== this.inputDragPointerId) return;
    const delta = event.global.x - this.inputDragStartX;
    if (Math.abs(delta) > INPUT_DRAG_TAP_TOLERANCE) this.inputDragMoved = true;
    this.inputScrollX = this.clampInputScrollX(this.inputDragStartScrollX + delta);
    this.applyInputScroll();
  };

  private handleInputPointerEnd = (event: FederatedPointerEvent): void => {
    if (this.inputDragPointerId === null || event.pointerId !== this.inputDragPointerId) return;
    this.inputDragPointerId = null;
  };

  /**
   * The one deliberate DOM element in this class — a real `<input>`,
   * invisible (`opacity: 0`, see createHiddenTextInput()) and kept
   * positioned exactly over the Pixi input pill on every layoutComposer()
   * call (see syncGhostInputBounds()). Focusing it (buildInputField()'s tap
   * handler) raises the device's own OS keyboard — autocorrect, predictive
   * text, personal dictionary, voice input, all free. Its `input` event is
   * the single bridge back into Pixi: `this.text = ghostInput.value` feeds
   * the exact same refreshInputVisual() pipeline every other change to
   * `this.text` already goes through, so the horizontal-scroll mask/pan
   * built for it works identically regardless of where a character came
   * from.
   *
   * A prior revision of this class instead hand-drew every key of a full
   * Arabic keyboard in Pixi, trading every one of the OS features above
   * away for zero DOM. Both are legitimate, deliberate architectural
   * choices — this is the second one.
   */
  private buildGhostInput(): HTMLInputElement {
    const input = createHiddenTextInput();
    input.addEventListener('input', () => {
      this.text = input.value;
      this.refreshInputVisual();
      this.previewText.text = this.text || SAMPLE_PHRASE;
    });
    input.addEventListener('focus', () => this.startCursorBlink());
    input.addEventListener('blur', () => this.stopCursorBlink());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
    return input;
  }

  /** Positions ghostInput's real DOM bounds over the Pixi input pill's current on-screen rectangle — Pixi's global coordinates already match page/viewport coordinates 1:1 (the one shared canvas fills the viewport edge-to-edge, see shellStyles.ts, and the page itself never scrolls, see documentShell.ts), so no extra offset math is needed. */
  private syncGhostInputBounds(pillGlobalX: number, pillGlobalY: number, width: number, height: number): void {
    this.ghostInput.style.left = `${pillGlobalX - width / 2}px`;
    this.ghostInput.style.top = `${pillGlobalY - height / 2}px`;
    this.ghostInput.style.width = `${width}px`;
    this.ghostInput.style.height = `${height}px`;
  }

  /**
   * Repaints the field's live text/placeholder/caret from `this.text` —
   * called on every keystroke from ghostInput's own `input` event (see
   * buildGhostInput()) and once up front so the field never starts blank
   * when it should show a pre-filled value (e.g. reopening the composer on
   * previously-committed text). The caret sits at the *leading* edge of the
   * rendered text block (its left side) because Arabic is RTL — typing
   * appends new glyphs to the left, so that is where the next character
   * will actually land, and `-text.width / 2` tracks that precisely as the
   * string grows or shrinks.
   */
  /**
   * Text stays at its one true `INPUT_FONT_SIZE` always — never shrunk,
   * never wrapped. This pill sits in a fixed-height top bar, alongside the
   * back button, with the effects bar/keyboard positioned at a fixed offset
   * below it — wrapping to a second line would grow the pill and cascade
   * into re-laying out everything beneath it, and shrinking a long phrase
   * down to fit works against the very thing a preview is for (reading back
   * what you typed). Instead, a line longer than the pill pans horizontally
   * — `scrollGroup` (see buildInputField()) is right-edge anchored, so it
   * grows leftward, unbounded, clipped by `mask`; this method keeps the
   * caret in view by panning `scrollGroup` exactly enough whenever the
   * caret would otherwise fall outside the visible window, the same way a
   * native phone keyboard's own text field does. handleInputPointerMove()
   * lets the player pan further by hand to review earlier characters.
   */
  private refreshInputVisual(): void {
    // Keeps ghostInput in sync even when this.text changed from a source
    // other than ghostInput's own `input` event (e.g. reopening the
    // composer pre-filled with previously-committed text) — a no-op when
    // it's already the source, since it's the same string either way.
    this.ghostInput.value = this.text;

    const hasText = this.text.length > 0;
    this.inputField.text.text = this.text;
    this.inputField.text.visible = hasText;
    this.inputField.placeholder.visible = !hasText;

    const availWidth = Math.max(0, this.inputFieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    // Fixed reference point: the text's own right edge always sits at the
    // window's right edge in scrollGroup's un-panned local space — the line
    // grows only leftward from there as more is typed (RTL).
    this.inputField.text.position.set(availWidth / 2, 0);

    const caretLocalX = availWidth / 2 - this.inputField.text.width - CURSOR_GAP;
    this.inputMaxScrollX = hasText ? Math.max(0, -availWidth / 2 - caretLocalX) : 0;
    // Auto-follow the caret while actively typing — a manual pan (see
    // handleInputPointerMove) can scroll away from this afterward, and the
    // very next keystroke snaps back to it, same as a native text field.
    this.inputScrollX = this.inputMaxScrollX;
    this.applyInputScroll();

    this.inputField.cursor.position.set(caretLocalX, 0);
  }

  private clampInputScrollX(x: number): number {
    return Math.max(0, Math.min(this.inputMaxScrollX, x));
  }

  private applyInputScroll(): void {
    this.inputField.scrollGroup.x = this.inputScrollX;
  }

  private startCursorBlink(): void {
    this.inputField.cursor.visible = true;
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = tickerSetInterval(this.deps.app.ticker, () => {
      this.inputField.cursor.visible = !this.inputField.cursor.visible;
    }, CURSOR_BLINK_MS);
  }

  private stopCursorBlink(): void {
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = undefined;
    this.inputField.cursor.visible = false;
  }

  /** Plain glass circle, same look as HeaderBar's own back/home buttons — see the BACK_* constants' doc comment for why this one stays outside the gold identity. */
  private buildBackButton(): { root: Container; bg: Graphics } {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-HANDLE_HIT_SIZE / 2, -HANDLE_HIT_SIZE / 2, HANDLE_HIT_SIZE, HANDLE_HIT_SIZE);

    const bg = new Graphics().circle(0, 0, BACK_DIAMETER / 2).fill({ color: BACK_BG_COLOR, alpha: BACK_BG_ALPHA });
    root.addChild(bg);

    const glyph = new Sprite();
    glyph.anchor.set(0.5);
    glyph.tint = BACK_ICON_TINT;
    glyph.width = BACK_ICON_SIZE;
    glyph.height = BACK_ICON_SIZE;
    root.addChild(glyph);
    void iconTexture('arrowBack', BACK_ICON_SOURCE_SIZE, '#ffffff').then((texture) => {
      glyph.texture = texture;
    });

    return { root, bg };
  }

  /**
   * One effects-bar frame: a rounded, glass-dark box (the "small
   * rounded-corner rectangle" preview slot) with a gold-identity border —
   * real `AdvancedBloomFilter` + `DropShadowFilter`, brighter/opaque when
   * this is the selected effect, dim when it isn't (see syncEffectFrames()) —
   * plus a plain white label below it (labels stay white across every
   * converted window, only icon-like marks carry the gold). The animated
   * preview itself (the dissolving "مرحبا" text/particles) is drawn
   * separately by the single shared `previewReveal`/`previewMask` pair and
   * only ever occupies one frame's rectangle at a time — see
   * runPreviewStep().
   */
  private buildEffectFrame(effect: TextRevealEffect, labelText: string): EffectFrameObj {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-FRAME_HIT_WIDTH / 2, FRAME_HIT_TOP, FRAME_HIT_WIDTH, FRAME_HIT_HEIGHT);

    const border = new Graphics();
    border.filters = effectFrameFilters();
    root.addChild(border);

    const label = new Text({ text: labelText, style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: LABEL_FONT_SIZE, fill: LABEL_IDLE_COLOR }) });
    label.anchor.set(0.5, 0);
    label.position.set(0, PREVIEW_H / 2 + LABEL_GAP);
    root.addChild(label);

    return { effect, root, border, label };
  }

  /** Recomputes every position from the current screen size — called once at construction and again on every resize, same pattern as PlanningIconColumn.layout(). */
  private layoutComposer(): void {
    const screen = this.deps.app.screen;
    const composerWidth = Math.min(COMPOSER_MAX_WIDTH, screen.width * COMPOSER_WIDTH_RATIO);
    const composerX = (screen.width - composerWidth) / 2;
    this.composerContainer.position.set(composerX, COMPOSER_TOP_Y);

    this.backButton.root.position.set(composerWidth - BACK_DIAMETER / 2, TOPBAR_HEIGHT / 2);

    const inputWidth = composerWidth - BACK_DIAMETER - GAP_BACK_INPUT;
    this.inputFieldWidth = inputWidth;
    this.inputField.root.position.set(inputWidth / 2, TOPBAR_HEIGHT / 2);
    this.inputField.root.hitArea = new Rectangle(-inputWidth / 2, -INPUT_HIT_HEIGHT / 2, inputWidth, INPUT_HIT_HEIGHT);
    this.inputField.bg
      .clear()
      .roundRect(-inputWidth / 2, -INPUT_HEIGHT / 2, inputWidth, INPUT_HEIGHT, 12)
      .fill({ color: 0xffffff, alpha: 0.08 });

    // A Pixi mask never added to the display tree is evaluated in *global*
    // space (the same convention this file's own previewMask already relies
    // on, see syncEffectFrames()) — so the clip rectangle has to be drawn at
    // the pill's real on-screen position, not root's local origin.
    const availWidth = Math.max(0, inputWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const pillGlobal = this.inputField.root.getGlobalPosition();
    this.inputField.mask
      .clear()
      .rect(pillGlobal.x - availWidth / 2, pillGlobal.y - INPUT_HEIGHT / 2, availWidth, INPUT_HEIGHT)
      .fill(0xffffff);
    this.syncGhostInputBounds(pillGlobal.x, pillGlobal.y, inputWidth, INPUT_HEIGHT);

    const contentBottom = this.layoutEffectFrames(composerWidth);
    this.catchAll.clear().rect(0, 0, composerWidth, contentBottom).fill({ color: 0x000000, alpha: 0.001 });

    // Re-applies the auto-scroll against the (possibly just-changed) input
    // width — a resize alone, with no new keystroke, can push already-typed
    // text's caret out of view on a narrower screen.
    this.refreshInputVisual();
  }


  /**
   * Replicates the old `.mzj-text-composer-effects { display: flex;
   * flex-wrap: wrap; justify-content: center; gap: 12px 14px; }` in Pixi
   * coordinates: pack frames into rows of `itemsPerRow` (however many fit
   * the current composer width, so this reflows exactly like the old flex
   * grid did on a narrower/wider screen), then center each row and place
   * its items right-to-left (RTL — the first frame in the array lands at
   * the row's right edge, matching `TEXT_EFFECTS`' own declared order).
   */
  /** Returns the content's bottom y (composer-local) once every row is placed, so layoutComposer() can size the catch-all backdrop to match. */
  private layoutEffectFrames(composerWidth: number): number {
    const itemsPerRow = Math.max(1, Math.floor((composerWidth + ITEM_GAP_X) / (PREVIEW_W + ITEM_GAP_X)));
    let rowTop = TOPBAR_HEIGHT + EFFECTS_MARGIN_TOP;

    for (let start = 0; start < this.effectFrames.length; start += itemsPerRow) {
      const row = this.effectFrames.slice(start, start + itemsPerRow);
      const rowContentWidth = row.length * PREVIEW_W + (row.length - 1) * ITEM_GAP_X;
      let rightEdge = composerWidth / 2 + rowContentWidth / 2;

      for (const frame of row) {
        frame.root.position.set(rightEdge - PREVIEW_W / 2, rowTop + PREVIEW_H / 2);
        rightEdge -= PREVIEW_W + ITEM_GAP_X;
      }
      rowTop += ITEM_HEIGHT + ITEM_GAP_Y;
    }

    this.syncEffectFrames();
    return rowTop - ITEM_GAP_Y;
  }
}
