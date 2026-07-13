import { Application, Container, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { icon } from './icons';
import { TextReveal, type TextRevealEffect } from '../effects/TextReveal';
import { TEXT_EFFECTS } from '../effects/textEffects/registry';

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
  /** True while the input+effects bar OR the control box is open — lets the caller hide whatever else is on screen (e.g. the planning screen's own icon columns) so this stays the sole focus. */
  onComposingChange: (composing: boolean) => void;
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

/** Ported by hand from Konva.js's real Transformer defaults (konva/src/shapes/Transformer.ts) — see the control-box doc comment below. */
const KONVA_BLUE = 0x00a1ff; // rgb(0, 161, 255): anchorStroke / borderStroke
const HANDLE_SIZE = 10; // anchorSize (anchorCornerRadius: 0 — an actual square, not a circle)
const HANDLE_STROKE_WIDTH = 1; // anchorStrokeWidth / borderStrokeWidth
const ROTATE_ANCHOR_OFFSET = 50; // rotateAnchorOffset: the rotate handle's stalk length
/** Not a Konva number — Konva has no touch story of its own (it leans on cursor changes, which don't exist on touch). Explicit oversized Pixi hitArea per finger, same idea as the old CSS invisible touch target. */
const HANDLE_HIT_SIZE = 44;
const BOX_PADDING = 14;

type HandleId = 'nw' | 'ne' | 'sw' | 'se';
const HANDLE_IDS: HandleId[] = ['nw', 'ne', 'sw', 'se'];

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
 * `root` (the top input + effects bar) is the one and only DOM element in
 * this class — real keyboard text entry has no Pixi equivalent, so it stays
 * plain HTML, same as every other compose-time toolbar in this app. The
 * control box itself (border, the 4 resize handles, the rotate handle +
 * its stalk) and the full-screen "tap outside to commit" backdrop are
 * genuine Pixi `Graphics`/`Container` objects living on `app.stage`,
 * positioned/rotated via Pixi's own `position`/`rotation` — never CSS —
 * so they never desync from the WebGL frame the way a DOM overlay can.
 * Their look is Konva.js's own Transformer defaults, ported by hand
 * (see the KONVA_* constants above and syncControlBoxTransform() below):
 * 10x10 square anchors, 1px `rgb(0, 161, 255)` stroke on a white fill, a
 * 50px rotate stalk — not an invented style.
 *
 * The effects bar's demo previews reuse the exact same TextReveal engine as
 * the real final reveal (same particle physics, no CSS/static-image
 * stand-in) via a dedicated instance, cycling through smoke/flame/none one
 * at a time (never more than one running at once) for as long as the input
 * row is open.
 */
export class TextComposer {
  readonly root: HTMLDivElement;
  private readonly deps: TextComposerDeps;
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
  private readonly cornerHandles: Record<HandleId, Graphics>;
  private readonly rotateLine: Graphics;
  private readonly rotateHandle: Graphics;
  /** Whichever corner handle is mid-drag, purely to reset its press-scale back to 1 on release without guessing which one it was. */
  private activeHandleGraphic: Graphics | null = null;

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
    deps.app.stage.addChild(this.previewText);
    this.syncPreviewTransform();

    this.root = document.createElement('div');
    this.root.id = 'mzj-text-composer';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

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
    deps.app.stage.addChild(this.backdrop);
    deps.app.renderer.on('resize', () => {
      const screen = deps.app.screen;
      this.backdrop.clear().rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.001 });
    });

    this.controlBox = new Container();
    this.controlBox.visible = false;
    deps.app.stage.addChild(this.controlBox);

    this.boxBorder = new Graphics();
    this.boxBorder.eventMode = 'static';
    this.boxBorder.cursor = 'grab';
    this.controlBox.addChild(this.boxBorder);

    this.cornerHandles = {
      nw: this.createHandleGraphic('nwse-resize'),
      ne: this.createHandleGraphic('nesw-resize'),
      sw: this.createHandleGraphic('nesw-resize'),
      se: this.createHandleGraphic('nwse-resize'),
    };
    for (const id of HANDLE_IDS) this.controlBox.addChild(this.cornerHandles[id]);

    this.rotateLine = new Graphics();
    this.controlBox.addChild(this.rotateLine);

    this.rotateHandle = this.createHandleGraphic('crosshair');
    this.controlBox.addChild(this.rotateHandle);

    this.wireInput();
    this.wireEffectButtons();
    this.wireBack();
    this.wireControlBox();
  }

  /** One 10x10 white/blue square (Konva's own anchor look, shared by every corner + the rotater), centered on its own local origin so positioning it is just a `.position.set()`. */
  private createHandleGraphic(cursor: string): Graphics {
    const handle = new Graphics();
    handle
      .rect(-HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
      .fill(0xffffff)
      .stroke({ width: HANDLE_STROKE_WIDTH, color: KONVA_BLUE });
    handle.eventMode = 'static';
    handle.cursor = cursor;
    handle.hitArea = new Rectangle(-HANDLE_HIT_SIZE / 2, -HANDLE_HIT_SIZE / 2, HANDLE_HIT_SIZE, HANDLE_HIT_SIZE);
    return handle;
  }

  /** Opens the composer pre-filled with whatever text/effect is currently set — used by the T icon and by tapping the committed text. */
  open(): void {
    this.closeControlBox();
    this.previewText.visible = false;
    this.query<HTMLInputElement>('#mzj-text-composer-input').value = this.text;
    this.syncEffectButtons();
    this.root.classList.remove('mzj-hidden');
    this.deps.onComposingChange(true);
    window.setTimeout(() => this.query<HTMLInputElement>('#mzj-text-composer-input').focus(), 50);
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
    this.root.classList.add('mzj-hidden');
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

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private wireInput(): void {
    const input = this.query<HTMLInputElement>('#mzj-text-composer-input');
    input.addEventListener('input', () => {
      this.text = input.value;
      this.previewText.text = this.text || SAMPLE_PHRASE;
    });
  }

  private wireEffectButtons(): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mzj-text-effect-btn'));
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        this.effect = btn.dataset.effect as TextRevealEffect;
        this.syncEffectButtons();
      });
    }
  }

  private syncEffectButtons(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.mzj-text-effect-btn')) {
      btn.classList.toggle('active', btn.dataset.effect === this.effect);
    }
  }

  private wireBack(): void {
    this.query<HTMLButtonElement>('#mzj-text-composer-back').addEventListener('click', () => {
      this.stopPreviewCycle();
      this.root.classList.add('mzj-hidden');
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
   * Per icon: show "مرحبا" plainly and statically first, hold briefly so
   * it's clearly read, then (for smoke/flame) run the real dissolve over
   * it — the exact same TextReveal engine as the final reveal, clipped to
   * this icon's own slot rectangle so nothing ever escapes it. 'none' just
   * holds the static word for a comparable beat, since it has no effect to
   * demonstrate. Advances to the next icon once done, looping forever.
   */
  private async runPreviewStep(generation: number): Promise<void> {
    if (!this.previewCycleActive || generation !== this.previewGeneration) return;

    const effect = PREVIEW_ORDER[this.previewIndex];
    const slot = this.root.querySelector<HTMLElement>(`.mzj-text-effect-preview[data-effect="${effect}"]`)!;
    const rect = slot.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fontScale = (rect.height * 0.4) / this.baseFontSize;

    this.previewMask.clear().rect(rect.left, rect.top, rect.width, rect.height).fill(0xffffff);

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
    this.activeHandleGraphic?.scale.set(1);
    this.activeHandleGraphic = null;
    this.activeRotatePointerId = null;
    this.rotateHandle.scale.set(1);
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

    this.wireResizeHandles();
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
      this.rotateHandle.scale.set(1);
      return;
    }
    if (event.pointerId === this.activeHandlePointerId) {
      this.activeHandlePointerId = null;
      this.activeHandleGraphic?.scale.set(1);
      this.activeHandleGraphic = null;
      return;
    }
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) this.pinchStartDist = null;
    if (this.activePointers.size < 1) this.dragStart = null;
  };

  /**
   * One-finger corner handles — equally capable as the two-finger pinch
   * above, not a fallback for it. Dragging a handle measures its distance
   * from the box's center and scales relative to where the drag started,
   * exactly like pinch does with two points instead of one.
   */
  private wireResizeHandles(): void {
    for (const id of HANDLE_IDS) {
      const handle = this.cornerHandles[id];
      handle.on('pointerdown', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        const { x, y } = event.global;
        this.activeHandlePointerId = event.pointerId;
        this.handleStartDist = Math.max(1, Math.hypot(x - this.posX, y - this.posY));
        this.handleStartScale = this.scale;
        this.activeHandleGraphic = handle;
        handle.scale.set(1.15);
      });
    }
  }

  /**
   * The rotate handle sits above the box and is a child of `controlBox`, so
   * Pixi's own `controlBox.rotation` already carries it around the center
   * as the player turns the text — the handle never needs its own position
   * math for that part. What this wires is purely "finger angle around the
   * center -> new rotation": on grab it records the offset between the
   * pointer's current angle (relative to `posX/posY`, in stage space,
   * independent of the box's own current rotation) and the current
   * rotation, then every move just re-applies that same offset to wherever
   * the finger now is — so the handle tracks the finger exactly, a full
   * 360° free turn, same technique the pinch/corner handles use for
   * distance instead of angle.
   */
  private wireRotateHandle(): void {
    this.rotateHandle.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activeRotatePointerId = event.pointerId;
      const angle = Math.atan2(y - this.posY, x - this.posX);
      this.rotateStartAngleOffset = this.rotation - angle;
      this.rotateHandle.scale.set(1.15);
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
   * border/handles/stalk below are all drawn centered on local (0, 0) —
   * the container's own transform carries all of them around together,
   * matching how Konva.js's own Transformer box works.
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
      .stroke({ width: HANDLE_STROKE_WIDTH, color: KONVA_BLUE });

    this.cornerHandles.nw.position.set(-hw, -hh);
    this.cornerHandles.ne.position.set(hw, -hh);
    this.cornerHandles.sw.position.set(-hw, hh);
    this.cornerHandles.se.position.set(hw, hh);

    this.rotateLine
      .clear()
      .moveTo(0, -hh)
      .lineTo(0, -hh - ROTATE_ANCHOR_OFFSET)
      .stroke({ width: HANDLE_STROKE_WIDTH, color: KONVA_BLUE });
    this.rotateHandle.position.set(0, -hh - ROTATE_ANCHOR_OFFSET);

    this.controlBox.position.set(this.posX, this.posY);
    this.controlBox.rotation = this.rotation;
  }

  private template(): string {
    return `
      <div class="mzj-text-composer-topbar">
        <button type="button" id="mzj-text-composer-back" aria-label="رجوع">${icon('arrowBack', 18)}</button>
        <input type="text" id="mzj-text-composer-input" class="mzj-text-composer-input" placeholder="اكتب عبارتك هنا" />
      </div>
      <div class="mzj-text-composer-effects">
        ${TEXT_EFFECTS.map((entry) => this.effectButton(entry.id, entry.label)).join('')}
      </div>
    `;
  }

  private effectButton(effect: TextRevealEffect, label: string): string {
    return `
      <button type="button" class="mzj-text-effect-btn" data-effect="${effect}">
        <span class="mzj-text-effect-preview" data-effect="${effect}"></span>
        <span>${label}</span>
      </button>
    `;
  }
}
