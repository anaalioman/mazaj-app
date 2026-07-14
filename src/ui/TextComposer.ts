import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { AdvancedBloomFilter, DropShadowFilter } from 'pixi-filters';
import { iconTexture } from './svgIconTexture';
import { TextReveal, type TextRevealEffect } from '../effects/TextReveal';
import { TEXT_EFFECTS } from '../effects/textEffects/registry';
import type { AudioManager } from '../audio/AudioManager';

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

/** The composer's own text field, root-centered like every other control in this file: a background pill, the live typed text, a dimmed placeholder shown when empty, and a blinking gold caret — see buildInputField(). */
interface InputFieldObj {
  root: Container;
  bg: Graphics;
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
const FRAME_FILL_COLOR = 0x080910;
const FRAME_FILL_ALPHA = 0.55;
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
 * `openGhostInput()` for the invisible keyboard-capture bridge that feeds
 * `this.text` (and therefore this display) its characters.
 */
const INPUT_FONT_SIZE = 15;
const INPUT_TEXT_COLOR = 0xffe9b3;
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
 * Every visible pixel of this class is genuine Pixi — the back button, the
 * input field (background pill, live text, placeholder, blinking gold
 * caret), the effects bar's 7 frames, the control box (border + two
 * dedicated corner handles), and the full-screen "tap outside to commit"
 * backdrop are all `Graphics`/`Container`/`Text` objects living on
 * `app.stage`, positioned via Pixi's own `position`/`rotation` — never CSS
 * — so they never desync from the WebGL frame the way a DOM overlay can.
 * The one DOM node this class ever creates is a fully invisible, 1x1px,
 * off-screen `<input>` inside its own isolated Shadow DOM root — the only
 * bridge the web platform exposes for summoning a real OS keyboard, since
 * `<canvas>` cannot receive IME focus (see openGhostInput()'s doc comment
 * for the full reasoning). It carries zero stylesheet footprint, is built
 * fresh every time typing starts, and is torn down completely the instant
 * it loses focus — nothing DOM ever lingers, and no pixel the player
 * actually sees is DOM. The control box border keeps Konva.js's own
 * Transformer border default (1px `rgb(0, 161, 255)`, see the KONVA_BLUE
 * constant); the two handles are their own dedicated multi-function
 * circles, not a generic 4-corner grid — nothing renders outside the box's
 * own rectangle (see HANDLE_* constants above and syncControlBoxTransform()
 * below).
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
  /** The sole DOM node this class ever creates — see openGhostInput()'s doc comment. Null whenever nothing is focused; never lingers past a blur. */
  private ghostHost: HTMLDivElement | null = null;
  private ghostInput: HTMLInputElement | null = null;
  private cursorBlinkTimer: number | undefined;
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
  private previewCycleTimer: number | undefined;

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

  /** Opens the composer pre-filled with whatever text/effect is currently set — used by the T icon and by tapping the committed text. Auto-focuses the ghost bridge after a short delay (same 50ms the old DOM `.focus()` used) so the keyboard rises as soon as the panel has visually settled. */
  open(): void {
    this.closeControlBox();
    this.previewText.visible = false;
    this.refreshInputVisual();
    this.syncEffectFrames();
    this.composerContainer.visible = true;
    this.deps.onComposingChange(true);
    window.setTimeout(() => this.openGhostInput(), 50);
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
    this.closeGhostInput();
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

  private syncEffectFrames(): void {
    for (const frame of this.effectFrames) {
      const active = frame.effect === this.effect;
      frame.border
        .clear()
        .roundRect(-PREVIEW_W / 2, -PREVIEW_H / 2, PREVIEW_W, PREVIEW_H, PREVIEW_RADIUS)
        .fill({ color: FRAME_FILL_COLOR, alpha: FRAME_FILL_ALPHA })
        .stroke({
          width: 1.5,
          color: active ? EFFECT_GOLD : FRAME_BORDER_IDLE_COLOR,
          alpha: active ? FRAME_BORDER_ACTIVE_ALPHA : FRAME_BORDER_IDLE_ALPHA,
        });
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
      this.closeGhostInput();
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
    window.clearTimeout(this.previewCycleTimer);
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
      this.previewCycleTimer = window.setTimeout(resolve, ms);
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
   * field's hitArea opens the ghost keyboard bridge (see openGhostInput()).
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

    const text = new Text({
      text: '',
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: INPUT_FONT_SIZE, fontWeight: '700', fill: INPUT_TEXT_COLOR }),
    });
    text.anchor.set(0.5);
    root.addChild(text);

    const cursor = new Graphics().rect(-CURSOR_WIDTH / 2, -CURSOR_HEIGHT / 2, CURSOR_WIDTH, CURSOR_HEIGHT).fill(EFFECT_GOLD);
    cursor.filters = effectFrameFilters();
    cursor.visible = false;
    root.addChild(cursor);

    root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.openGhostInput();
    });

    return { root, bg, text, placeholder, cursor };
  }

  /**
   * Repaints the field's live text/placeholder/caret from `this.text` —
   * called on every native `input` event from the ghost bridge (see
   * openGhostInput()) and once up front so the field never starts blank
   * when it should show a pre-filled value (e.g. reopening the composer on
   * previously-committed text). The caret sits at the *leading* edge of the
   * rendered text block (its left side) because Arabic is RTL — typing
   * appends new glyphs to the left, so that is where the next character
   * will actually land, and `-text.width / 2` tracks that precisely as the
   * string grows or shrinks.
   */
  private refreshInputVisual(): void {
    const hasText = this.text.length > 0;
    this.inputField.text.text = this.text;
    this.inputField.text.visible = hasText;
    this.inputField.placeholder.visible = !hasText;

    const caretX = hasText ? -this.inputField.text.width / 2 - CURSOR_GAP : 0;
    this.inputField.cursor.position.set(caretX, 0);
  }

  private startCursorBlink(): void {
    this.inputField.cursor.visible = true;
    window.clearInterval(this.cursorBlinkTimer);
    this.cursorBlinkTimer = window.setInterval(() => {
      this.inputField.cursor.visible = !this.inputField.cursor.visible;
    }, CURSOR_BLINK_MS);
  }

  private stopCursorBlink(): void {
    window.clearInterval(this.cursorBlinkTimer);
    this.cursorBlinkTimer = undefined;
    this.inputField.cursor.visible = false;
  }

  /**
   * The one and only DOM this class ever creates: a fully invisible, 1x1px,
   * off-screen `<input>` inside its own isolated Shadow DOM root. This
   * exists purely because no web API lets a `<canvas>` receive IME/keyboard
   * focus — summoning Android/iOS's on-screen keyboard requires a real,
   * focusable, editable DOM node, full stop; there is no Canvas-only way
   * around it. Every other canvas-based text editor (Figma, Google's canvas
   * tools, etc.) bridges this exact same way. What makes this a genuine
   * "ghost" rather than a disguised text field:
   *   - Zero stylesheet footprint: every rule below is a direct inline
   *     `style.*` assignment, never a class, never a `mazajUI.css` rule.
   *   - Shadow DOM isolation: even if a style rule here were wrong, the
   *     shadow boundary guarantees it cannot leak onto the rest of the app.
   *   - Built fresh on every focus, destroyed completely on blur (see
   *     closeGhostInput()) — nothing DOM ever lingers between keystroke
   *     sessions.
   *   - Zero visible pixels: 1×1, `opacity:0`, parked off-screen at
   *     (-9999, -9999). The player only ever sees the gold Pixi glyphs and
   *     caret in `inputField`.
   * The `input` listener below is the actual "receives characters" logic:
   * every native `input` event (typed key, IME commit, paste, voice
   * dictation — anything the OS keyboard can produce) copies `ghost.value`
   * into `this.text` and repaints the Pixi field via refreshInputVisual().
   */
  private openGhostInput(): void {
    if (this.ghostInput) {
      this.ghostInput.focus();
      return;
    }

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-9999px';
    host.style.top = '-9999px';
    host.style.width = '1px';
    host.style.height = '1px';
    host.style.overflow = 'hidden';
    const shadow = host.attachShadow({ mode: 'open' });

    const ghost = document.createElement('input');
    ghost.type = 'text';
    ghost.value = this.text;
    ghost.style.width = '1px';
    ghost.style.height = '1px';
    ghost.style.opacity = '0';
    ghost.style.border = 'none';
    ghost.style.padding = '0';
    ghost.style.margin = '0';
    ghost.style.background = 'transparent';
    ghost.style.caretColor = 'transparent';
    shadow.appendChild(ghost);
    document.body.appendChild(host);

    // The actual character-receiving logic: every native `input` event this
    // ghost fires (keystroke, IME commit, paste, dictation) is mirrored
    // straight into `this.text`, which repaints the genuine Pixi glyphs and
    // caret — the ghost's own value is never itself rendered anywhere.
    ghost.addEventListener('input', () => {
      this.text = ghost.value;
      this.refreshInputVisual();
      this.previewText.text = this.text || SAMPLE_PHRASE;
    });
    ghost.addEventListener('blur', () => this.closeGhostInput());
    for (const type of ['pointerdown', 'click', 'change'] as const) {
      ghost.addEventListener(type, (event) => event.stopPropagation());
    }

    this.ghostHost = host;
    this.ghostInput = ghost;
    ghost.focus();
    this.startCursorBlink();
  }

  /** Tears the ghost bridge down completely — see openGhostInput()'s doc comment for why nothing DOM may linger past a blur. */
  private closeGhostInput(): void {
    this.ghostHost?.remove();
    this.ghostHost = null;
    this.ghostInput = null;
    this.stopCursorBlink();
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
    this.inputField.root.position.set(inputWidth / 2, TOPBAR_HEIGHT / 2);
    this.inputField.root.hitArea = new Rectangle(-inputWidth / 2, -INPUT_HIT_HEIGHT / 2, inputWidth, INPUT_HIT_HEIGHT);
    this.inputField.bg
      .clear()
      .roundRect(-inputWidth / 2, -INPUT_HEIGHT / 2, inputWidth, INPUT_HEIGHT, 12)
      .fill({ color: 0xffffff, alpha: 0.08 });

    const contentBottom = this.layoutEffectFrames(composerWidth);
    this.catchAll.clear().rect(0, 0, composerWidth, contentBottom).fill({ color: 0x000000, alpha: 0.001 });
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
