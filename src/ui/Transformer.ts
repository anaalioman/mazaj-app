import { Application, Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';

/**
 * A standalone, single-purpose figma-style transform widget: a border box
 * plus a rotate handle (top-right) and a resize handle (bottom-right),
 * drag/pinch-to-move, drag-to-rotate, drag-or-pinch-to-scale. It owns no
 * text/content state at all — it is handed a `TransformerTarget` snapshot
 * to draw itself against, and reports every gesture back up through
 * `TransformerCallbacks` rather than mutating anything itself. The caller
 * (TextComposer) remains the sole source of truth for position/rotation/
 * scale; this class is purely input (touch gestures in) and output (a
 * drawn box + two handles), created fresh for each editing session and
 * `destroy()`-ed the moment it ends — see TextComposer's openControlBox()/
 * closeControlBox().
 *
 * The box outline keeps Konva.js's real Transformer border default
 * (konva/src/shapes/Transformer.ts): borderStroke 'rgb(0, 161, 255)',
 * borderStrokeWidth 1, no radius.
 */
const KONVA_BLUE = 0x00a1ff;
const BOX_BORDER_WIDTH = 1;
const BOX_PADDING = 14;

const HANDLE_VISUAL_DIAMETER = 24;
const HANDLE_FILL = 0xfff6df;
const HANDLE_STROKE = 0xc98f34;
const HANDLE_STROKE_WIDTH = 2;
/** Explicit oversized Pixi hitArea per finger — the circle stays 24px, the tappable area is still a generous 44x44 for accurate mobile touch. */
const HANDLE_HIT_SIZE = 44;

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Everything the Transformer needs to draw itself for one frame — a plain snapshot, not a live reference, so the caller decides exactly when it updates (see TextComposer's syncTransforms()). */
export interface TransformerTarget {
  x: number;
  y: number;
  /** Radians, same convention as Pixi's own `rotation` (0 = upright, clockwise-positive). */
  rotation: number;
  /** The content's current scale factor — only used as the gesture's starting reference for a *new* scale, never applied to anything here. */
  scale: number;
  /** The content's own unrotated on-screen width/height at its current scale (e.g. `previewText.width/height`) — the border is drawn `BOX_PADDING` outside this on every edge. */
  contentWidth: number;
  contentHeight: number;
}

export interface TransformerCallbacks {
  /** Reports the new absolute (x, y) once the box border is dragged — not a delta. */
  onMove(x: number, y: number): void;
  /** Reports the new absolute rotation (radians) from the rotate handle. */
  onRotate(rotation: number): void;
  /** Reports the new absolute scale (already clamped to [MIN_SCALE, MAX_SCALE]) from the resize handle or a two-finger pinch on the border. */
  onScale(scale: number): void;
}

export class Transformer {
  private readonly app: Application;
  private readonly callbacks: TransformerCallbacks;
  private readonly container: Container;
  private readonly boxBorder: Graphics;
  private readonly rotateHandle: { root: Container; glow: Graphics };
  private readonly resizeHandle: { root: Container; glow: Graphics };
  private target: TransformerTarget;

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

  constructor(app: Application, uiContainer: Container, target: TransformerTarget, callbacks: TransformerCallbacks) {
    this.app = app;
    this.callbacks = callbacks;
    this.target = target;

    this.container = new Container();
    uiContainer.addChild(this.container);

    this.boxBorder = new Graphics();
    this.boxBorder.eventMode = 'static';
    this.boxBorder.cursor = 'grab';
    this.container.addChild(this.boxBorder);

    this.rotateHandle = this.createHandle('crosshair');
    this.container.addChild(this.rotateHandle.root);

    this.resizeHandle = this.createHandle('nwse-resize');
    this.container.addChild(this.resizeHandle.root);

    this.wireBoxDrag();
    this.wireResizeHandle();
    this.wireRotateHandle();

    app.stage.on('pointermove', this.handlePointerMove);
    app.stage.on('pointerup', this.handlePointerEnd);
    app.stage.on('pointerupoutside', this.handlePointerEnd);

    this.redraw();
  }

  /** Repaints the border + repositions both handles against a fresh target snapshot — called once at construction and again any time the caller's own state changes (move/rotate/scale, or the content's rendered size changes for any other reason, e.g. a font reload). */
  update(target: TransformerTarget): void {
    this.target = target;
    this.redraw();
  }

  /** Tears down every trace of this instance: the two `app.stage`-level listeners and the whole display-object subtree (border + both handles' Graphics/filters). Called the moment editing ends (commit or tap-outside) — see TextComposer's closeControlBox(). No gated/idle listener is ever left running while nothing is being edited. */
  destroy(): void {
    this.app.stage.off('pointermove', this.handlePointerMove);
    this.app.stage.off('pointerup', this.handlePointerEnd);
    this.app.stage.off('pointerupoutside', this.handlePointerEnd);
    this.container.destroy({ children: true });
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

  /**
   * Sized from the target's own *local* (unrotated) content width/height —
   * not a rotated stage-space AABB, which would make the box balloon out as
   * soon as the content tilts. `container` is positioned at (target.x,
   * target.y) and rotated by `target.rotation` as one unit via Pixi's own
   * `position`/`rotation`, which is why the border and both handles are
   * drawn/positioned centered on local (0, 0) — the container's own
   * transform carries all of them around together. Nothing is ever
   * positioned outside the box's own rectangle: the rotate handle sits
   * exactly on the top-right corner, the resize handle exactly on the
   * bottom-right corner, no stalk sticking out above.
   */
  private redraw(): void {
    const width = this.target.contentWidth + BOX_PADDING * 2;
    const height = this.target.contentHeight + BOX_PADDING * 2;
    const hw = width / 2;
    const hh = height / 2;

    this.boxBorder
      .clear()
      .rect(-hw, -hh, width, height)
      .fill({ color: 0x000000, alpha: 0.001 })
      .stroke({ width: BOX_BORDER_WIDTH, color: KONVA_BLUE });

    this.rotateHandle.root.position.set(hw, -hh);
    this.resizeHandle.root.position.set(hw, hh);

    this.container.position.set(this.target.x, this.target.y);
    this.container.rotation = this.target.rotation;
  }

  private wireBoxDrag(): void {
    this.boxBorder.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activePointers.set(event.pointerId, { x, y });

      if (this.activePointers.size === 1) {
        this.dragStart = { x: x - this.target.x, y: y - this.target.y };
      } else if (this.activePointers.size === 2) {
        const [a, b] = Array.from(this.activePointers.values());
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchStartScale = this.target.scale;
      }
    });
  }

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
      this.handleStartDist = Math.max(1, Math.hypot(x - this.target.x, y - this.target.y));
      this.handleStartScale = this.target.scale;
      this.resizeHandle.glow.visible = true;
    });
  }

  /**
   * The top-right handle: on grab it records the offset between the
   * pointer's current angle (relative to the target's own x/y, in stage
   * space, independent of the box's current rotation) and the current
   * rotation, then every move just re-applies that same offset to wherever
   * the finger now is — so the handle tracks the finger exactly, a full
   * 360° free turn.
   */
  private wireRotateHandle(): void {
    this.rotateHandle.root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const { x, y } = event.global;
      this.activeRotatePointerId = event.pointerId;
      const angle = Math.atan2(y - this.target.y, x - this.target.x);
      this.rotateStartAngleOffset = this.target.rotation - angle;
      this.rotateHandle.glow.visible = true;
    });
  }

  /**
   * Every drag/resize/rotate gesture starts on a specific Pixi object's own
   * `pointerdown` (the box border, a corner handle, or the rotate handle),
   * but `pointermove`/`pointerup` are handled once here on `app.stage` —
   * the standard Pixi pattern for "keep tracking a finger even once it
   * slides off the small object that grabbed it" (there's no DOM-style
   * `setPointerCapture` for a Pixi DisplayObject). No visibility guard is
   * needed here (contrast with a permanent listener that gates itself on
   * `if (!visible) return`): this whole instance, listeners included, only
   * exists between `new Transformer(...)` and `destroy()`.
   */
  private handlePointerMove = (event: FederatedPointerEvent): void => {
    const { x, y } = event.global;

    if (event.pointerId === this.activeRotatePointerId) {
      this.callbacks.onRotate(Math.atan2(y - this.target.y, x - this.target.x) + this.rotateStartAngleOffset);
      return;
    }

    if (event.pointerId === this.activeHandlePointerId) {
      const dist = Math.hypot(x - this.target.x, y - this.target.y);
      this.callbacks.onScale(clamp(this.handleStartScale * (dist / this.handleStartDist), MIN_SCALE, MAX_SCALE));
      return;
    }

    if (!this.activePointers.has(event.pointerId)) return;
    this.activePointers.set(event.pointerId, { x, y });

    if (this.activePointers.size >= 2 && this.pinchStartDist !== null) {
      const [a, b] = Array.from(this.activePointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.callbacks.onScale(clamp(this.pinchStartScale * (dist / this.pinchStartDist), MIN_SCALE, MAX_SCALE));
    } else if (this.activePointers.size === 1 && this.dragStart) {
      this.callbacks.onMove(x - this.dragStart.x, y - this.dragStart.y);
    }
  };

  private handlePointerEnd = (event: FederatedPointerEvent): void => {
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
}
