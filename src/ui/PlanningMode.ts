import { Application, Container, Graphics, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import type { BurstType } from '../fireworks/FireworksSystem';

export interface VisibleRange {
  /** Screen y where the reachable (dashboard-free) area begins. */
  top: number;
  /** Height of that reachable area. */
  height: number;
}

export interface PlanningModeDeps {
  app: Application;
  /**
   * Fires whatever a normal tap would have, but forced to a specific
   * pattern, at (x, y). `onComplete`, when given, must fire once that
   * specific shot's explosion has genuinely finished playing (every
   * descendant particle faded) — see FireworksSystem.launch()'s own
   * `onComplete` param, which this should be wired straight into.
   */
  onLaunchPin: (x: number, y: number, type: BurstType, onComplete?: () => void) => void;
  /**
   * Whatever's currently visible outside the dashboard (or the full screen
   * once it's hidden) — the coordinate space pins are placed in while
   * planning.
   */
  getVisibleRange: () => VisibleRange;
  /** The shape a new pin should be stamped with; a tap places nothing if none is selected yet. */
  getActiveShape: () => BurstType | null;
  /** Maps a tapped x to where a new pin should actually land — identity in "حر" input mode, snapped to the nearest mortar tube in "مدفع", so pin placement follows the same targeting mode as ordinary free-tap firing. */
  resolveX: (x: number) => number;
}

const SEQUENTIAL_DELAY_MS = 800;
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;
const PIN_RADIUS = 13;
const PIN_HIT_RADIUS = PIN_RADIUS * 1.6;

interface Pin {
  x: number;
  y: number;
  type: BurstType;
  /** Visible range in effect when this pin was placed — see getVisibleRange. */
  reference: VisibleRange;
  container: Container;
  numberText: Text;
}

/**
 * Sequential-launch placement: while active, tapping empty space places a
 * numbered pin stamped with whatever shape is currently selected in the
 * planning screen; tapping an existing pin does nothing on a quick tap —
 * only a 500ms press-and-hold removes it (and renumbers the rest). Pins
 * stay fixed and fully visible throughout planning; "ابدأ العرض" (not a
 * button in here) is what actually fires them, each 800ms apart in the
 * order they were placed, then clears the board in the same instant.
 */
export class PlanningMode {
  private readonly app: Application;
  private readonly onLaunchPin: (x: number, y: number, type: BurstType, onComplete?: () => void) => void;
  private readonly getVisibleRange: () => VisibleRange;
  private readonly getActiveShape: () => BurstType | null;
  private readonly resolveX: (x: number) => number;
  private readonly layer: Container;
  private pins: Pin[] = [];
  private active = false;

  private pressTimer: number | undefined;
  private pressTargetIndex: number | null = null;
  private pressStart: { x: number; y: number } | null = null;

  constructor(deps: PlanningModeDeps) {
    this.app = deps.app;
    this.onLaunchPin = deps.onLaunchPin;
    this.getVisibleRange = deps.getVisibleRange;
    this.getActiveShape = deps.getActiveShape;
    this.resolveX = deps.resolveX;
    this.layer = new Container();
    this.layer.visible = false;
    this.app.stage.addChild(this.layer);

    this.app.stage.on('pointerdown', this.handlePointerDown);
    this.app.stage.on('pointermove', this.handlePointerMove);
    this.app.stage.on('pointerup', this.handlePointerUp);
    this.app.stage.on('pointerupoutside', this.handlePointerUp);
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(enabled: boolean): void {
    this.active = enabled;
    this.layer.visible = enabled;
    if (!enabled) this.cancelPress();
  }

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    if (!this.active) return;
    const { x, y } = event.global;

    const hitIndex = this.pins.findIndex((pin) => Math.hypot(pin.x - x, pin.y - y) <= PIN_HIT_RADIUS);
    if (hitIndex >= 0) {
      this.pressTargetIndex = hitIndex;
      this.pressStart = { x, y };
      this.pressTimer = window.setTimeout(() => {
        if (this.pressTargetIndex !== null) this.removePinAt(this.pressTargetIndex);
        this.cancelPress();
      }, LONG_PRESS_MS);
      return;
    }

    const type = this.getActiveShape();
    if (type) this.addPin(this.resolveX(x), y, type);
  };

  private handlePointerMove = (event: FederatedPointerEvent): void => {
    if (!this.active || !this.pressStart) return;
    const { x, y } = event.global;
    if (Math.hypot(x - this.pressStart.x, y - this.pressStart.y) > MOVE_CANCEL_PX) this.cancelPress();
  };

  private handlePointerUp = (): void => {
    this.cancelPress();
  };

  private cancelPress(): void {
    window.clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
    this.pressTargetIndex = null;
    this.pressStart = null;
  }

  /**
   * Fires every placed pin, 800ms apart in placement order, each forced to
   * the shape it was stamped with. Every pin (and its number) stays fixed
   * and fully visible throughout planning — the whole board clears in one
   * instant right as this is called (the moment the scene begins), then the
   * shots themselves fire on their staggered timing, each rescaled from the
   * visible strip it was planned in up to the full screen height in effect
   * right now. `onAllComplete`, if given, fires once every fired pin's
   * explosion has genuinely finished (not on a timer) — a no-op call
   * (immediate `onAllComplete()`, nothing fired) if nothing was placed.
   */
  launch(onAllComplete?: () => void): void {
    if (this.pins.length === 0) {
      onAllComplete?.();
      return;
    }
    const pins = [...this.pins];
    this.clear();
    const fullHeight = this.app.screen.height;

    let remaining = pins.length;
    const markOneDone = onAllComplete
      ? () => {
          remaining--;
          if (remaining <= 0) onAllComplete();
        }
      : undefined;

    pins.forEach((pin, i) => {
      window.setTimeout(
        () => this.onLaunchPin(pin.x, this.rescaleY(pin, fullHeight), pin.type, markOneDone),
        i * SEQUENTIAL_DELAY_MS,
      );
    });
  }

  /** Maps a pin's y from the reachable strip it was placed in (proportionally) up to the full screen height in effect now. */
  private rescaleY(pin: Pin, fullHeight: number): number {
    const { top, height } = pin.reference;
    if (height <= 0) return pin.y;
    const proportion = (pin.y - top) / height;
    return proportion * fullHeight;
  }

  clear(): void {
    for (const pin of this.pins) this.removePinVisual(pin);
    this.pins = [];
  }

  private removePinVisual(pin: Pin): void {
    this.layer.removeChild(pin.container);
    pin.container.destroy({ children: true });
  }

  private addPin(x: number, y: number, type: BurstType): void {
    const container = new Container();
    container.position.set(x, y);

    const ring = new Graphics();
    ring.circle(0, 0, PIN_RADIUS).fill({ color: 0xffcf6b, alpha: 0.22 });
    ring.circle(0, 0, PIN_RADIUS).stroke({ width: 2.5, color: 0xffcf6b });
    container.addChild(ring);

    const numberText = new Text({
      text: String(this.pins.length + 1),
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontWeight: '800', fontSize: 14, fill: 0x2a1400 }),
    });
    numberText.anchor.set(0.5);
    container.addChild(numberText);

    this.layer.addChild(container);
    this.pins.push({ x, y, type, reference: this.getVisibleRange(), container, numberText });
  }

  private removePinAt(index: number): void {
    const [removed] = this.pins.splice(index, 1);
    this.removePinVisual(removed);
    // Smart renumbering: everything after the removed pin shifts down by one.
    this.pins.forEach((pin, i) => {
      pin.numberText.text = String(i + 1);
    });
  }
}
