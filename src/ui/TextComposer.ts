import { Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { iconTexture } from './svgIconTexture';
import { createGhostInputBridge } from './textComposer/GhostInputBridge';
import { InputFieldView } from './textComposer/InputFieldView';
import { ModeRowEngine } from './textComposer/ModeRowEngine';
import { PreviewControlBox } from './textComposer/PreviewControlBox';
import {
  BACK_BG_ALPHA,
  BACK_BG_COLOR,
  BACK_DIAMETER,
  BACK_HIT_SIZE,
  BACK_ICON_SIZE,
  BACK_ICON_SOURCE_SIZE,
  BACK_ICON_TINT,
  COMPOSER_MAX_WIDTH,
  COMPOSER_TOP_Y,
  COMPOSER_WIDTH_RATIO,
  EFFECT_GOLD,
  EFFECTS_MARGIN_TOP,
  GAP_BACK_INPUT,
  GLOW_DISTANCE,
  GLOW_QUALITY,
  INPUT_GLOW_BASE,
  MODE_ROW_MARGIN_TOP,
  SAMPLE_PHRASE,
  TOPBAR_HEIGHT,
  type TextComposerDeps,
  type TextRevealConfig,
} from './textComposer/types';

export type { TextComposerDeps, TextRevealConfig } from './textComposer/types';

/**
 * Free-text composing flow for the "T" icon: a live top input + a golden
 * mode row (fuse/spark-eraser/spring/smoke-cloud — see ComposeMode/RowMode's
 * own doc comments in textComposer/types.ts), a back arrow that closes all
 * of that and reveals the player's real text in a draggable +
 * pinch-resizable + rotatable control box, and tapping outside commits it
 * (bare text, no chrome) at whatever position/scale/rotation was left.
 * Tapping the committed text later reopens this whole flow pre-filled.
 * Position/scale/rotation persist in memory for as long as the mood
 * instance lives (see fireworksMood.ts's module doc). There is no
 * reveal-effect picker here — the real show always reveals via
 * `CharacterReveal` (see TextReveal.ts), the sole reveal path.
 *
 * This class is the orchestrator over five focused modules in
 * `./textComposer/`:
 * - `types.ts` — constants, shared types, pure helpers.
 * - `GhostInputBridge.ts` — the one deliberate DOM element (a hidden
 *   `<textarea>` bridging the OS keyboard's autocorrect/predictive
 *   text/voice input into Pixi).
 * - `InputFieldView.ts` — the input pill's own visuals, horizontal+vertical
 *   scroll/mask ("Masked Scroll"), and caret hit-testing.
 * - `ModeRowEngine.ts` — the compose-mode row, the fuse-rope effect, the
 *   delete-spark particle burst, and the input field's own insert-pop —
 *   every ticker-driven animation the composing flow has.
 * - `PreviewControlBox.ts` — the settled/committed text and its
 *   draggable/rotatable/resizable control box (a fresh `Transformer` per
 *   editing session).
 *
 * This class remains the single source of truth for the composed `text`
 * itself and for gluing the five pieces together (which callback fires
 * which other module's method) — the same role `PlanningIconColumn`'s own
 * `ColumnContainer` plays over its own split-out modules.
 */
export class TextComposer {
  private readonly deps: TextComposerDeps;
  private readonly composerContainer: Container;
  /** Swallows taps that land in the gaps between the input pill/mode row/back button — see the constructor's own doc comment where it's built. */
  private readonly catchAll: Graphics;
  private readonly backButton: { root: Container; bg: Graphics };
  /** The one real DOM element in this whole feature — see GhostInputBridge's own doc comment. */
  private readonly ghostInput: HTMLTextAreaElement;
  private readonly inputGlow: GlowFilter;
  private readonly inputView: InputFieldView;
  private readonly modeRow: ModeRowEngine;
  private readonly previewControlBox: PreviewControlBox;
  private readonly baseFontSize: number;

  private text = SAMPLE_PHRASE;
  private hasCommittedOnce = false;
  /** Snapshot of `modeRow.smokeCloudActive` taken at the exact moment of commit (see confirmAndOpenControlBox()) — what consumeForReveal() actually reads once the control box has been shown at least once for the current text, since the live flag itself gets reset for the *next* word by then. */
  private committedSmokeActive = false;

  constructor(deps: TextComposerDeps) {
    this.deps = deps;

    const { width, height } = deps.app.screen;
    this.baseFontSize = Math.max(36, Math.min(width, height) * 0.09);

    this.previewControlBox = new PreviewControlBox(deps.app, deps.worldContainer, deps.uiContainer, this.baseFontSize, width / 2, height / 2, {
      onTapPreview: () => this.open(),
      onCommitRequested: () => this.commit(),
    });

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
    // layoutComposer(), doing nothing but swallowing the tap.
    this.catchAll = new Graphics();
    this.catchAll.eventMode = 'static';
    this.catchAll.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.composerContainer.addChild(this.catchAll);

    this.inputGlow = new GlowFilter({ distance: GLOW_DISTANCE, outerStrength: INPUT_GLOW_BASE, innerStrength: 0, color: EFFECT_GOLD, quality: GLOW_QUALITY });

    // The ghost input is created before InputFieldView (which needs the
    // actual element reference) and before ModeRowEngine — its callbacks
    // close over `this` and only actually read `this.inputView`/
    // `this.modeRow` once a real focus/input DOM event fires, well after
    // this constructor has finished assigning both fields. Same
    // forward-reference-via-closure this class's own single-file ancestor
    // already relied on.
    this.ghostInput = createGhostInputBridge({
      getCurrentText: () => this.text,
      onTextChange: (oldText, newText) => {
        if (this.modeRow.isSparkEraserActive() && newText.length < oldText.length) this.modeRow.triggerDeleteSpark(oldText, newText);
        this.text = newText;
        this.inputView.refresh(this.text, {
          allowBouncePop: this.modeRow.isSpringActive(),
          onBouncePop: () => this.modeRow.triggerInputBounce(),
        });
        this.previewControlBox.setText(this.text || SAMPLE_PHRASE);
      },
      onFocus: () => this.inputView.startCursorBlink(),
      onBlur: () => this.inputView.stopCursorBlink(),
      // Keeps the drawn caret in sync with the real textarea's own selection
      // for any move that isn't a tap or a keystroke (e.g. the OS keyboard's
      // arrow keys, or a native long-press-drag to reposition) — `input`
      // only fires when the *text* changes, not when just the caret does.
      onSelectionChange: () => this.inputView.refresh(this.text, { allowBouncePop: false, onBouncePop: () => {} }),
    });

    this.inputView = new InputFieldView(deps.app, this.ghostInput, this.inputGlow);
    this.composerContainer.addChild(this.inputView.root);

    this.modeRow = new ModeRowEngine(deps.app, deps.audio, this.composerContainer, deps.worldContainer, this.inputView, this.inputGlow, () => this.text);

    this.backButton = this.buildBackButton();
    // Added last, deliberately — Pixi renders later-added children on top,
    // so this guarantees the back arrow always sits visually above the mode
    // row and the fuse rope/ember, regardless of whatever any of those are
    // doing (a bounce mid-pop, the fuse ember riding past its own row). Per
    // the standing "السهم هو القائد العام" rule: no mode icon may ever
    // visually cover or intercept it, now or after any future addition to
    // this composer.
    this.composerContainer.addChild(this.backButton.root);

    deps.app.renderer.on('resize', () => this.layoutComposer());
    this.layoutComposer();
    this.inputView.refresh(this.text, { allowBouncePop: false, onBouncePop: () => {} });

    this.wireBack();
  }

  /** Opens the composer pre-filled with whatever text is currently set — used by the T icon and by tapping the committed text. The OS keyboard only opens once the player actually taps the input pill, not automatically here. */
  open(): void {
    this.previewControlBox.closeControlBox();
    this.previewControlBox.hide();
    this.inputView.refresh(this.text, { allowBouncePop: false, onBouncePop: () => {} });
    this.composerContainer.visible = true;
    this.deps.onComposingChange(true);
  }

  /**
   * Returns the config beginShow() should reveal with, and hides the static
   * preview so the real animated reveal can take over without the two
   * overlapping. Null if the player never actually went through the
   * composer at all this session — callers should fall back to their own
   * default in that case.
   *
   * `smokeCloud` is where the smoke-cloud mode's choice actually gets used
   * — deliberately not read live here (see PreviewControlBox/ModeRowEngine's
   * own doc comments: the effect must never animate before the real show
   * starts). Which field is authoritative depends on whether the control
   * box was ever actually shown for *this* text: if the preview is already
   * visible, confirmAndOpenControlBox() already ran and reset the live
   * `smokeCloudActive` for whatever comes next, so `committedSmokeActive`
   * (its snapshot) is the real answer. If it's still hidden, the player
   * pressed "ابدأ العرض" without ever tapping the composer's own arrow —
   * confirmAndOpenControlBox() never ran, so the live flag itself is still
   * the current, uncommitted choice for this text.
   */
  consumeForReveal(): TextRevealConfig | null {
    const smokeCloud = this.previewControlBox.visible ? this.committedSmokeActive : this.modeRow.smokeCloudActive;
    // Defensive: the show can start (via the header's always-available
    // "ابدأ العرض") while the composer or control box is still open.
    this.composerContainer.visible = false;
    this.ghostInput.blur();
    this.previewControlBox.closeControlBox();
    this.previewControlBox.hide();
    if (!this.hasCommittedOnce) return null;
    return {
      text: this.text,
      x: this.previewControlBox.posX,
      y: this.previewControlBox.posY,
      fontScale: this.previewControlBox.scale,
      rotation: this.previewControlBox.rotation,
      smokeCloud,
    };
  }

  private wireBack(): void {
    this.backButton.root.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.backButton.root.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.deps.audio.playUiClick();
      this.confirmAndOpenControlBox();
    });
  }

  /**
   * Leaves the input and reveals the committed text in its
   * draggable/resizable/rotatable control box — the transition the back
   * arrow triggers.
   *
   * `composeMode`/`smokeCloudActive` reset to their own defaults inside
   * `modeRow.resetForNextCommit()` — once a mode has actually been used
   * (this commit *is* that use), it has no business still showing
   * "selected" the next time the composer opens for a new word.
   * `committedSmokeActive` is that method's own returned pre-reset
   * snapshot — consumeForReveal() reads it from there once the real show
   * actually starts.
   */
  private confirmAndOpenControlBox(): void {
    this.ghostInput.blur();
    this.composerContainer.visible = false;
    this.text = this.text.trim() ? this.text : SAMPLE_PHRASE;
    this.previewControlBox.setText(this.text);
    this.previewControlBox.show();
    this.committedSmokeActive = this.modeRow.resetForNextCommit();
    this.previewControlBox.refreshTransform();
    this.previewControlBox.openControlBox();
    this.deps.onComposingChange(true);
  }

  /** Tapping the backdrop outside the box commits it: chrome disappears, bare text stays at its last position/scale. */
  private commit(): void {
    this.previewControlBox.closeControlBox();
    this.hasCommittedOnce = true;
    this.deps.onComposingChange(false);
  }

  /** Plain glass circle, same look as HeaderBar's own back/home buttons — see the BACK_* constants' doc comment (types.ts) for why this one stays outside the gold identity. */
  private buildBackButton(): { root: Container; bg: Graphics } {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Rectangle(-BACK_HIT_SIZE / 2, -BACK_HIT_SIZE / 2, BACK_HIT_SIZE, BACK_HIT_SIZE);

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

  /** Recomputes every position from the current screen size — called once at construction and again on every resize, same pattern as PlanningIconColumn.layout(). */
  private layoutComposer(): void {
    const screen = this.deps.app.screen;
    const composerWidth = Math.min(COMPOSER_MAX_WIDTH, screen.width * COMPOSER_WIDTH_RATIO);
    const composerX = (screen.width - composerWidth) / 2;
    this.composerContainer.position.set(composerX, COMPOSER_TOP_Y);

    this.backButton.root.position.set(composerWidth - BACK_DIAMETER / 2, TOPBAR_HEIGHT / 2);

    const inputWidth = composerWidth - BACK_DIAMETER - GAP_BACK_INPUT;
    this.inputView.setWidth(inputWidth, { x: inputWidth / 2, y: TOPBAR_HEIGHT / 2 });

    const contentBottom = this.modeRow.layoutRow(composerWidth, TOPBAR_HEIGHT + EFFECTS_MARGIN_TOP - MODE_ROW_MARGIN_TOP);
    this.catchAll.clear().rect(0, 0, composerWidth, contentBottom).fill({ color: 0x000000, alpha: 0.001 });

    // Re-applies the auto-scroll against the (possibly just-changed) input
    // width — a resize alone, with no new keystroke, can push already-typed
    // text's caret out of view on a narrower screen.
    this.inputView.refresh(this.text, { allowBouncePop: false, onBouncePop: () => {} });
  }
}
