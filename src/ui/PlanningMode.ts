import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

export interface VisibleRange {
  /** Screen y where the reachable (dashboard-free) area begins. */
  top: number;
  /** Height of that reachable area. */
  height: number;
}

export interface PlanningModeDeps {
  app: Application;
  /** Fires whatever a normal tap would have (aerial burst or Ground Fountain) at (x, y). */
  onLaunchPin: (x: number, y: number) => void;
  /**
   * Whatever's currently visible outside the dashboard (or the full screen
   * once it's hidden) — the coordinate space pins are placed in while
   * planning.
   */
  getVisibleRange: () => VisibleRange;
}

const SEQUENTIAL_DELAY_MS = 800;
const PIN_RADIUS = 13;
const PIN_HIT_RADIUS = PIN_RADIUS * 1.6;

interface Pin {
  x: number;
  y: number;
  /** Visible range in effect when this pin was placed — see getVisibleRange. */
  reference: VisibleRange;
  container: Container;
  numberText: Text;
}

/**
 * Planning & Sequencing Mode: while active, tapping the stage places a
 * numbered pin instead of firing immediately. Pins are placed and rendered
 * strictly within whatever area is still visible outside the dashboard —
 * they never appear on top of it or peek out from behind it. A dedicated
 * Launch call then fires every pin in tap order — either all in the same
 * instant ("All at Once") or staggered 800ms apart ("Sequential") — by
 * replaying the same onLaunchPin callback a normal tap would have used, so
 * it stays in sync with whatever burst/Ground-Fountain mode is currently
 * configured. Each pin's y is rescaled at that moment from the reachable
 * strip it was placed in up to whatever's the full screen height by then,
 * so a shape planned near the edge of that strip fires near the matching
 * edge of the real screen once the dashboard is out of the way.
 */
export class PlanningMode {
  private readonly app: Application;
  private readonly onLaunchPin: (x: number, y: number) => void;
  private readonly getVisibleRange: () => VisibleRange;
  private readonly layer: Container;
  private pins: Pin[] = [];
  private active = false;
  private sequential = false;

  constructor(deps: PlanningModeDeps) {
    this.app = deps.app;
    this.onLaunchPin = deps.onLaunchPin;
    this.getVisibleRange = deps.getVisibleRange;
    this.layer = new Container();
    this.layer.visible = false;
    this.app.stage.addChild(this.layer);
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(enabled: boolean): void {
    this.active = enabled;
    this.layer.visible = enabled;
  }

  /** Toggles instantly: existing pins stay put, only their numbers show/hide. */
  setSequential(enabled: boolean): void {
    this.sequential = enabled;
    for (const pin of this.pins) pin.numberText.visible = this.sequential;
  }

  /** Places a new pin at (x, y); tapping an existing one removes it and renumbers the rest. */
  handleTap(x: number, y: number): void {
    const hitIndex = this.pins.findIndex((pin) => Math.hypot(pin.x - x, pin.y - y) <= PIN_HIT_RADIUS);
    if (hitIndex >= 0) {
      this.removePinAt(hitIndex);
    } else {
      this.addPin(x, y);
    }
  }

  /**
   * Fires every placed pin per the current mode. Every pin (and its number)
   * stays fixed and fully visible throughout planning — the whole board
   * clears in one instant the moment Launch is pressed (the scene begins),
   * then the shots themselves fire per the current mode's timing, each
   * rescaled from the visible strip it was planned in up to the full
   * screen height in effect right now.
   */
  launch(): void {
    if (this.pins.length === 0) return;
    const pins = [...this.pins];
    this.clear();
    const fullHeight = this.app.screen.height;

    if (this.sequential) {
      pins.forEach((pin, i) => {
        window.setTimeout(() => this.onLaunchPin(pin.x, this.rescaleY(pin, fullHeight)), i * SEQUENTIAL_DELAY_MS);
      });
    } else {
      for (const pin of pins) this.onLaunchPin(pin.x, this.rescaleY(pin, fullHeight));
    }
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

  private addPin(x: number, y: number): void {
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
    numberText.visible = this.sequential;
    container.addChild(numberText);

    this.layer.addChild(container);
    this.pins.push({ x, y, reference: this.getVisibleRange(), container, numberText });
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
