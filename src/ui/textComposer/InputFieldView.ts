import { AdvancedBloomFilter, DropShadowFilter, type GlowFilter } from 'pixi-filters';
import { CanvasTextMetrics, Container, Graphics, Rectangle, Text, TextStyle, type Application, type FederatedPointerEvent } from 'pixi.js';
import { tickerSetInterval, type TickerTimerHandle } from '../../utils/tickerTimers';
import {
  CURSOR_BLINK_MS,
  CURSOR_GAP,
  CURSOR_HEIGHT,
  CURSOR_WIDTH,
  EFFECT_GOLD,
  INPUT_FONT_SIZE,
  INPUT_HEIGHT,
  INPUT_HIT_HEIGHT,
  INPUT_LINE_HEIGHT,
  INPUT_TEXT_COLOR,
  PLACEHOLDER_ALPHA,
  PLACEHOLDER_COLOR,
  PLACEHOLDER_TEXT,
  clampNumber,
  type InputFieldObj,
} from './types';

function inputCaretFilters(): (AdvancedBloomFilter | DropShadowFilter)[] {
  return [
    new AdvancedBloomFilter({ threshold: 0.3, blur: 3, quality: 4, bloomScale: 1.1, brightness: 1.05 }),
    new DropShadowFilter({ color: 0x000000, alpha: 0.45, blur: 2, offset: { x: 0, y: 2 } }),
  ];
}

/**
 * Reverse of hitTestCaretIndex(): given an absolute character index into a
 * composed multi-line string (as `ghostInput.selectionStart` reports it — a
 * single offset into the *whole* string, `\n`s included), finds which line
 * it falls on and its offset within just that line's own text.
 */
export function locateCaretPosition(lines: string[], caretIndex: number): { lineIndex: number; offsetInLine: number } {
  let consumed = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (i === lines.length - 1 || caretIndex <= consumed + lineLength) {
      return { lineIndex: i, offsetInLine: clampNumber(caretIndex - consumed, 0, lineLength) };
    }
    consumed += lineLength + 1; // +1 for the '\n' itself
  }
  return { lineIndex: 0, offsetInLine: 0 };
}

/**
 * The text field itself: a glass pill (background matches the old
 * `.mzj-text-composer-input`'s `rgba(255,255,255,0.08)`), the live typed
 * text (gold `#ffe9b3`), a dimmed placeholder shown only while empty, and a
 * blinking gold caret with the same `AdvancedBloomFilter`/`DropShadowFilter`
 * recipe as the mode row's own frames — "مؤشر ذهبي متسق مع الهوية الملكية".
 * Focus fires the instant a finger touches the pill (`pointerdown`, not the
 * later `pointertap`) so the OS keyboard opens with no extra delay waiting
 * for release; a drag instead (or in addition — focusing does not cancel
 * it) pans the text to review earlier content.
 *
 * Owns the pill's own visual objects, its horizontal+vertical scroll/pan
 * state (the composer's "Masked Scroll" — `scrollGroup` clipped by `mask`),
 * drag tracking, and caret-blink timing. Does not own the composed text
 * itself (`ghostInput.value` is the source the caller feeds in via
 * `refresh()`) or the compose-mode/animation decisions triggered by typing
 * (those live in ModeRowEngine — `refresh()` only reports "the text grew"
 * via its `onBouncePop` callback, gated by the caller's own `allowBouncePop`
 * so this view never has to know what a "spring" mode even is).
 */
export class InputFieldView {
  private readonly app: Application;
  private readonly ghostInput: HTMLTextAreaElement;
  readonly root: Container;
  readonly scrollGroup: Container;
  private readonly obj: InputFieldObj;

  /** The pill's own available width, set by setWidth() — used by refresh()'s auto-scroll and by ModeRowEngine's fuse-rope/delete-spark math (see getFieldWidth()). */
  private fieldWidth = 0;
  /** Current pan offset applied to scrollGroup.x — 0 is fully right-aligned (resting position, the last line's own trailing edge at the window's right edge); positive values shift the group right, revealing more of that line's left (most-recently-typed) end. Clamped to [0, maxScrollX]. */
  private scrollX = 0;
  /** How far scrollX can go — 0 once the last line fits the pill outright; recomputed every refresh() call from that line alone (not the whole multi-line block). */
  private maxScrollX = 0;
  /** Current pan offset applied to scrollGroup.y — 0 is fully bottom-aligned (the last line visible, every earlier line clipped above by `mask`); positive values shift the group down, revealing earlier lines. Clamped to [0, maxScrollY]. */
  private scrollY = 0;
  /** How far scrollY can go — 0 once every line already fits the pill's one-line-tall window; recomputed every refresh() call from the full block's height. */
  private maxScrollY = 0;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartScrollX = 0;
  private dragStartScrollY = 0;
  private cursorBlinkTimer: TickerTimerHandle | undefined;
  /** The text as of the previous refresh() call — this view's own baseline for telling an addition (pop-worthy) apart from a deletion (not); the *decision* whether that pop is currently allowed (spring mode) still lives with the caller. */
  private previousTextForBounce = '';

  constructor(app: Application, ghostInput: HTMLTextAreaElement, inputGlow: GlowFilter) {
    this.app = app;
    this.ghostInput = ghostInput;

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
    // real size once the pill's width is known, in setWidth().
    const mask = new Graphics();

    // Bottom-right anchored (see `textDisplay.anchor` below): both axes grow
    // *away* from a fixed corner as more is typed — right-to-left for a
    // line's own characters (RTL), upward for additional lines — clipped by
    // `mask`, panned via refresh()'s scrollX/Y once content outgrows the
    // pill's one-line-tall window.
    const scrollGroup = new Container();
    scrollGroup.mask = mask;
    root.addChild(scrollGroup);

    const textDisplay = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Tajawal, system-ui, sans-serif',
        fontSize: INPUT_FONT_SIZE,
        fontWeight: '700',
        fill: INPUT_TEXT_COLOR,
        lineHeight: INPUT_LINE_HEIGHT,
      }),
    });
    // (1, 1): anchored at the block's own bottom-right corner. For a single
    // line this reproduces the old vertically-centered look; for multiple
    // lines the block simply grows *upward* past the window from that fixed
    // corner, so the most-recently-typed line always sits at the bottom —
    // the exact same "auto-follow via a fixed anchor + a stationary mask"
    // trick the X axis already used before multi-line existed, now doing
    // the same job on Y for free, with no separate scroll math needed for
    // the default (non-dragged) case.
    textDisplay.anchor.set(1, 1);
    textDisplay.filters = [inputGlow];
    scrollGroup.addChild(textDisplay);

    const cursor = new Graphics().rect(-CURSOR_WIDTH / 2, -CURSOR_HEIGHT / 2, CURSOR_WIDTH, CURSOR_HEIGHT).fill(EFFECT_GOLD);
    cursor.filters = inputCaretFilters();
    cursor.visible = false;
    scrollGroup.addChild(cursor);

    root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      // The browser's own default mousedown/pointerdown action runs *after*
      // this listener and blurs whatever is currently focused whenever the
      // down-target isn't itself a focusable element — true here, since the
      // down-target is the shared `<canvas>`. Left alone, that default
      // action fires immediately after `.focus()` below and silently steals
      // focus straight back to `<body>` in the very same event. This is
      // exactly what the browser's own default is for — never call it
      // without a concrete reason — and this is one: suppress it so the
      // focus below actually sticks.
      event.preventDefault();
      this.dragPointerId = event.pointerId;
      this.dragStartX = event.global.x;
      this.dragStartY = event.global.y;
      this.dragStartScrollX = this.scrollX;
      this.dragStartScrollY = this.scrollY;
      // Fires immediately on touch-down, not on release — see this
      // handler's own doc comment. A drag that follows doesn't cancel it;
      // reviewing text by panning while the OS keyboard stays open is the
      // same experience any native multi-line field gives.
      this.ghostInput.focus();

      // Pixel-accurate tap-to-position: map the touch straight to a
      // character index and hand it to the real <textarea>'s own selection,
      // so the next keystroke/backspace acts from exactly where the player
      // touched — not always from the end. `scrollGroup.toLocal()` undoes
      // every ancestor transform up to and including scrollGroup's own
      // current pan offset, landing exactly in the same unpanned coordinate
      // space `textDisplay`/`cursor` are positioned in below, so it needs no
      // manual adjustment for the current scroll.
      const local = this.scrollGroup.toLocal(event.global);
      const hitIndex = this.hitTestCaretIndex(this.ghostInput.value, local.x, local.y);
      this.ghostInput.setSelectionRange(hitIndex, hitIndex);
      // A tap only ever moves the selection, never the text itself, so
      // refresh()'s own length-grew check can never fire here regardless of
      // what's passed for allowBouncePop — hardcoding false is exactly
      // equivalent to the caller's real answer, not a behavior shortcut.
      this.refresh(this.ghostInput.value, { allowBouncePop: false, onBouncePop: () => {} });
    });
    root.on('pointertap', (event: FederatedPointerEvent) => {
      // Focus already happened on pointerdown above — this only still
      // exists to stop the tap from bubbling to app.stage's tap-to-fire
      // rocket listener underneath.
      event.stopPropagation();
    });

    this.root = root;
    this.scrollGroup = scrollGroup;
    this.obj = { root, bg, scrollGroup, mask, text: textDisplay, placeholder, cursor };

    app.stage.on('pointermove', this.handlePointerMove);
    app.stage.on('pointerup', this.handlePointerEnd);
    app.stage.on('pointerupoutside', this.handlePointerEnd);
  }

  /** Sets the typed text's own pop scale — driven by ModeRowEngine's syncInputBounce(), which owns the bounce timing/easing but not this view's own display objects. */
  setPopScale(scale: number): void {
    this.obj.text.scale.set(scale);
  }

  getFieldWidth(): number {
    return this.fieldWidth;
  }

  get textStyle(): TextStyle {
    return this.obj.text.style;
  }

  /** Recomputes the pill's hitArea/mask for a new available width — called once at construction and again on every resize, from TextComposer's own layoutComposer(). */
  setWidth(width: number, rootPosition: { x: number; y: number }): void {
    this.fieldWidth = width;
    this.root.position.set(rootPosition.x, rootPosition.y);
    this.root.hitArea = new Rectangle(-width / 2, -INPUT_HIT_HEIGHT / 2, width, INPUT_HIT_HEIGHT);
    this.obj.bg
      .clear()
      .roundRect(-width / 2, -INPUT_HEIGHT / 2, width, INPUT_HEIGHT, 12)
      .fill({ color: 0xffffff, alpha: 0.08 });

    // A Pixi mask never added to the display tree is evaluated in *global*
    // space — so the clip rectangle has to be drawn at the pill's real
    // on-screen position, not root's local origin.
    const availWidth = Math.max(0, width - CURSOR_WIDTH - CURSOR_GAP * 2);
    const pillGlobal = this.root.getGlobalPosition();
    this.obj.mask
      .clear()
      .rect(pillGlobal.x - availWidth / 2, pillGlobal.y - INPUT_HEIGHT / 2, availWidth, INPUT_HEIGHT)
      .fill(0xffffff);
  }

  /**
   * Repaints the field's live text/placeholder/caret from `text` — called on
   * every keystroke and every selection change from the ghost input, on
   * every tap (which also moves the real selection first), and once up
   * front so the field never starts blank when it should show a pre-filled
   * value (e.g. reopening the composer on previously-committed text). Runs
   * synchronously inline with whichever of those triggered it — no
   * deferral, so the redraw always lands in the very same frame as the
   * keystroke/tap that caused it.
   *
   * Text stays at its one true `INPUT_FONT_SIZE` always — never shrunk,
   * never wrapped to fit a fixed-size pill. What *does* grow now is line
   * count: pressing the OS keyboard's Return key inserts a real `\n`, and
   * `textDisplay.text` renders every line Pixi's own canvas text engine
   * always could — multi-line was never a rendering gap, only a matter of
   * this method's own math and the field's fixed one-line-tall window
   * (`INPUT_HEIGHT`).
   *
   * `textDisplay.anchor` is pinned to the block's own bottom-right corner,
   * so the *last* line's *own* trailing edge always sits at that fixed
   * corner with zero extra math — a line longer than the pill grows
   * leftward (RTL) past the corner, a second-or-later line grows upward
   * past it, both simply clipped by the stationary `mask`. The caret,
   * though, can now sit anywhere in the text (see hitTestCaretIndex()) —
   * `ghostInput.selectionStart` is the single source of truth for where,
   * read fresh every call — so the old "always snap fully to one edge"
   * auto-scroll is replaced by `nudgeScrollToReveal()`: shift the view the
   * *minimum* amount needed to keep the caret in the visible window, in
   * whichever direction it's actually out of view, leaving it untouched if
   * the caret (e.g. a spot the player just tapped) was already visible. For
   * a caret sitting at the true end this still converges on exactly the old
   * snap-to-edge result.
   */
  refresh(text: string, bounce: { allowBouncePop: boolean; onBouncePop: () => void }): void {
    // Keeps ghostInput in sync even when `text` changed from a source other
    // than the ghost input's own `input` event (e.g. reopening the composer
    // pre-filled with previously-committed text) — comparing first (rather
    // than assigning unconditionally) matters here: setting `.value` to a
    // string that's already current would otherwise reset the very
    // selection a tap/selectionchange just established.
    if (this.ghostInput.value !== text) this.ghostInput.value = text;

    const hasText = text.length > 0;
    this.obj.text.text = text;
    this.obj.text.visible = hasText;
    this.obj.placeholder.visible = !hasText;

    // Pop only on genuine additions (typing/pasting), never on deletion —
    // and only while the caller says it's currently allowed (spring mode).
    if (bounce.allowBouncePop && text.length > this.previousTextForBounce.length && text !== this.previousTextForBounce) {
      bounce.onBouncePop();
    }
    this.previousTextForBounce = text;
    // Recomputed every call since the text's own width changes with every
    // keystroke: with anchor (1, 1) the rendered texture spans local
    // x ∈ [-width, 0], y ∈ [-height, 0], so its visual center sits at
    // (-width/2, -height/2) — `origin`, not `pivot`, so re-centering it
    // here never nudges the text's own on-screen position.
    this.obj.text.origin.set(-this.obj.text.width / 2, -this.obj.text.height / 2);

    const availWidth = Math.max(0, this.fieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    // Reproduces the single-line field's old vertically-centered look
    // exactly (INPUT_HEIGHT=36, INPUT_FONT_SIZE=15 leaves 21px of slack —
    // this anchors the bottom line's own baseline area at the same y a
    // (1, 0.5)-anchored single line used to sit at) while still leaving
    // room above for earlier lines to scroll up into, unseen, behind
    // `mask`.
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;
    this.obj.text.position.set(availWidth / 2, anchorY);

    const lines = text.split('\n');
    const lineWidths = lines.map((line) => (line.length ? CanvasTextMetrics.measureText(line, this.obj.text.style).width : 0));
    const widestLineWidth = Math.max(0, ...lineWidths);

    // Bounds on how far the player can pan by hand — the *widest* line's
    // own extent, not just the last line's: an earlier line can easily be
    // longer than wherever the caret currently sits.
    this.maxScrollX = hasText ? Math.max(0, widestLineWidth + CURSOR_GAP - availWidth) : 0;
    this.maxScrollY = hasText ? Math.max(0, this.obj.text.height - INPUT_HEIGHT + bottomPad) : 0;

    if (!hasText) {
      this.scrollX = 0;
      this.scrollY = 0;
      this.applyScroll();
      this.obj.cursor.position.set(availWidth / 2 - CURSOR_GAP, anchorY - INPUT_LINE_HEIGHT / 2);
      return;
    }

    const caretIndex = clampNumber(this.ghostInput.selectionStart ?? text.length, 0, text.length);
    const { lineIndex, offsetInLine } = locateCaretPosition(lines, caretIndex);
    const prefixWidth = offsetInLine ? CanvasTextMetrics.measureText(lines[lineIndex].slice(0, offsetInLine), this.obj.text.style).width : 0;
    const caretLocalX = availWidth / 2 - prefixWidth - CURSOR_GAP;
    const linesFromBottom = lines.length - 1 - lineIndex;
    const caretLocalY = anchorY - linesFromBottom * INPUT_LINE_HEIGHT - INPUT_LINE_HEIGHT / 2;

    this.scrollX = this.nudgeScrollToReveal(this.scrollX, caretLocalX, -availWidth / 2, availWidth / 2, this.maxScrollX);
    this.scrollY = this.nudgeScrollToReveal(this.scrollY, caretLocalY, -INPUT_HEIGHT / 2, INPUT_HEIGHT / 2, this.maxScrollY);
    this.applyScroll();

    this.obj.cursor.position.set(caretLocalX, caretLocalY);
  }

  /**
   * Real glyph-metric hit-testing, not a guess: maps a touch point (already
   * in scrollGroup's own unpanned local space, see the constructor's
   * `pointerdown` handler) to the nearest character boundary. First picks
   * the tapped *line* from the vertical offset from the fixed bottom
   * anchor, then walks that one line's own prefix widths — via
   * `CanvasTextMetrics`, the same technique CharacterReveal.ts already uses
   * for per-character positions — and picks whichever boundary the tap
   * actually landed closest to.
   */
  hitTestCaretIndex(text: string, localX: number, localY: number): number {
    const lines = text.split('\n');
    const availWidth = Math.max(0, this.fieldWidth - CURSOR_WIDTH - CURSOR_GAP * 2);
    const bottomPad = (INPUT_HEIGHT - INPUT_FONT_SIZE) / 2;
    const anchorY = INPUT_HEIGHT / 2 - bottomPad;

    const rawLineFromBottom = Math.round((anchorY - localY) / INPUT_LINE_HEIGHT);
    const lineFromBottom = clampNumber(rawLineFromBottom, 0, lines.length - 1);
    const lineIndex = lines.length - 1 - lineFromBottom;
    const lineText = lines[lineIndex];

    let bestOffset = lineText.length;
    let bestDist = Infinity;
    for (let i = 0; i <= lineText.length; i++) {
      const prefix = lineText.slice(0, i);
      const prefixWidth = prefix.length ? CanvasTextMetrics.measureText(prefix, this.obj.text.style).width : 0;
      const boundaryX = availWidth / 2 - prefixWidth;
      const dist = Math.abs(boundaryX - localX);
      if (dist < bestDist) {
        bestDist = dist;
        bestOffset = i;
      }
    }

    let consumed = 0;
    for (let i = 0; i < lineIndex; i++) consumed += lines[i].length + 1;
    return consumed + bestOffset;
  }

  /**
   * Touch-panning for the input field — "التحكم بالإصبع" alongside the
   * auto-scroll refresh() already does on both axes while typing.
   * Registered globally on `app.stage` in the constructor (a drag has to
   * keep tracking even once the finger moves outside the pill's own small
   * hitArea), gated on its own `dragPointerId` so it never interferes with
   * anything else reading stage-level pointer events.
   */
  private handlePointerMove = (event: FederatedPointerEvent): void => {
    if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
    const deltaX = event.global.x - this.dragStartX;
    const deltaY = event.global.y - this.dragStartY;
    this.scrollX = clampNumber(this.dragStartScrollX + deltaX, 0, this.maxScrollX);
    // Dragging the finger down (positive deltaY) reveals earlier lines —
    // the same direction a chat log or any bottom-anchored feed scrolls.
    this.scrollY = clampNumber(this.dragStartScrollY + deltaY, 0, this.maxScrollY);
    this.applyScroll();
  };

  private handlePointerEnd = (event: FederatedPointerEvent): void => {
    if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = null;
  };

  /**
   * Shifts `current` the minimum amount needed so that `pointLocal` (already
   * in the same unpanned local space `current` is applied against) lands
   * within `[windowMin, windowMax]`; leaves it untouched if the point is
   * already inside that range. Shared by both axes in refresh().
   */
  private nudgeScrollToReveal(current: number, pointLocal: number, windowMin: number, windowMax: number, max: number): number {
    const visible = pointLocal + current;
    let next = current;
    if (visible < windowMin) next += windowMin - visible;
    else if (visible > windowMax) next -= visible - windowMax;
    return clampNumber(next, 0, max);
  }

  private applyScroll(): void {
    this.scrollGroup.x = this.scrollX;
    this.scrollGroup.y = this.scrollY;
  }

  startCursorBlink(): void {
    this.obj.cursor.visible = true;
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = tickerSetInterval(
      this.app.ticker,
      () => {
        this.obj.cursor.visible = !this.obj.cursor.visible;
      },
      CURSOR_BLINK_MS,
    );
  }

  stopCursorBlink(): void {
    this.cursorBlinkTimer?.cancel();
    this.cursorBlinkTimer = undefined;
    this.obj.cursor.visible = false;
  }
}
