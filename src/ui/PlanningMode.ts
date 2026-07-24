import { Application, Container, Graphics, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import type { BurstType } from '../fireworks/FireworksSystem';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';
import { trackSwipeOrTap } from '../utils/swipeGesture';

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
  /** True while PlanningScreen's icon column/side panel are slid away for shot placement — see PlanningScreen.isChromeHidden(). Gates whether a fresh tap on empty space might instead be the swipe-to-reveal gesture (see onSwipeReveal). */
  isChromeHidden: () => boolean;
  /** The right-to-left swipe-to-reveal gesture fired instead of placing a pin — see PlanningScreen.revealChrome(). */
  onSwipeReveal: () => void;
}

const SEQUENTIAL_DELAY_MS = 800;
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
 * planning screen; tapping an *existing* pin removes it immediately (and
 * renumbers the rest) — a plain confirm-by-tapping-again, no long hold
 * needed. Pins stay fixed and fully visible throughout planning; "ابدأ
 * العرض" (not a button in here) is what actually fires them, each 800ms
 * apart in the order they were placed, then clears the board in the same
 * instant.
 */
export class PlanningMode {
  private readonly app: Application;
  private readonly onLaunchPin: (x: number, y: number, type: BurstType, onComplete?: () => void) => void;
  private readonly getVisibleRange: () => VisibleRange;
  private readonly getActiveShape: () => BurstType | null;
  private readonly resolveX: (x: number) => number;
  private readonly isChromeHidden: () => boolean;
  private readonly onSwipeReveal: () => void;
  /** Public so fireworksMood.ts can reparent it into uiContainer (planning-time placement markers, not final art — see fireworksMood.ts's own container-tree doc comment). */
  readonly layer: Container;
  private pins: Pin[] = [];
  private active = false;
  // launch()'s staggered per-pin timer handles — tracked so a show that's
  // exited mid-sequence (see cancelPending()) can't keep popping rockets
  // after the player has already left it.
  private pendingLaunchTimers: TickerTimerHandle[] = [];

  constructor(deps: PlanningModeDeps) {
    this.app = deps.app;
    this.onLaunchPin = deps.onLaunchPin;
    this.getVisibleRange = deps.getVisibleRange;
    this.getActiveShape = deps.getActiveShape;
    this.resolveX = deps.resolveX;
    this.isChromeHidden = deps.isChromeHidden;
    this.onSwipeReveal = deps.onSwipeReveal;
    this.layer = new Container();
    this.layer.visible = false;
    this.app.stage.addChild(this.layer);

    this.app.stage.on('pointerdown', this.handlePointerDown);
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(enabled: boolean): void {
    this.active = enabled;
    this.layer.visible = enabled;
  }

  private handlePointerDown = (event: FederatedPointerEvent): void => {
    if (!this.active) return;
    // Converts through `layer`'s own transform rather than reading
    // event.global directly — a no-op today (layer sits untransformed
    // directly on app.stage, so this equals event.global exactly), but
    // keeps pin placement correct if layer is ever nested/offset/scaled
    // in the future without silently drifting.
    const { x, y } = this.layer.toLocal(event.global);

    const hitIndex = this.pins.findIndex((pin) => Math.hypot(pin.x - x, pin.y - y) <= PIN_HIT_RADIUS);

    // While the chrome is slid away for placement, a leftward drag past the
    // threshold always means "bring the panels back" — checked before
    // anything else (even before whether a shape is currently armed, or an
    // existing pin was hit), so a swipe can never get silently swallowed by
    // "no shape picked yet" or "this landed on an existing pin". See
    // PlanningScreen.isChromeHidden()/revealChrome() and swipeGesture.ts's
    // own doc comment on why this has to be resolved inside the existing
    // handler rather than via a competing stage-level listener.
    if (this.isChromeHidden()) {
      trackSwipeOrTap(
        this.app,
        event,
        () => this.onSwipeReveal(),
        () => this.resolveTap(hitIndex, x, y),
      );
      return;
    }
    this.resolveTap(hitIndex, x, y);
  };

  /** A confirmed plain tap (not a swipe): removes the pin it landed on, or places a new one if a shape is armed — the two outcomes a tap in this mode can ever have. */
  private resolveTap(hitIndex: number, x: number, y: number): void {
    if (hitIndex >= 0) {
      this.removePinAt(hitIndex);
      return;
    }
    const type = this.getActiveShape();
    if (type) this.addPin(this.resolveX(x), y, type);
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
    // Any timers from a previous launch() have either already fired or were
    // already cancelled by then — safe to drop before scheduling this one's.
    this.pendingLaunchTimers = [];
    const fullHeight = this.app.screen.height;

    let remaining = pins.length;
    const markOneDone = onAllComplete
      ? () => {
          remaining--;
          if (remaining <= 0) onAllComplete();
        }
      : undefined;

    pins.forEach((pin, i) => {
      const timer = tickerSetTimeout(
        this.app.ticker,
        () => this.onLaunchPin(pin.x, this.rescaleY(pin, fullHeight), pin.type, markOneDone),
        i * SEQUENTIAL_DELAY_MS,
      );
      this.pendingLaunchTimers.push(timer);
    });
  }

  /**
   * Cancels every not-yet-fired staggered launch from the most recent
   * launch() call — the real fix for a genuine leak a field test caught:
   * pressing exit mid-sequence used to leave those timers running, so
   * rockets kept firing on the idle/planning screen well after the player
   * had already left it. Wired into fireworksMood.ts's endShow().
   */
  cancelPending(): void {
    for (const timer of this.pendingLaunchTimers) timer.cancel();
    this.pendingLaunchTimers = [];
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
