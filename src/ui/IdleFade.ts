import type { Container, Ticker } from 'pixi.js';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';

const DEFAULT_IDLE_MS = 5000;
/** Matches the old CSS `.mzj-fade-target` rule's `transition: opacity 0.18s ease` — fading back in still eases over this long; hiding is instant (the old rule's `display: none` never animated either, since CSS doesn't tween to/from `display: none`). */
const FADE_IN_MS = 180;

/**
 * Fades a set of Pixi containers out after a period of no pointer activity
 * anywhere on the page, and instantly brings them back on the next
 * movement/tap. Hiding sets `visible = false` immediately (matching the old
 * CSS `.mzj-idle` rule's `display: none !important` — a genuinely zero-cost,
 * zero-hit-testable hide, not just alpha 0); showing tweens `alpha` back up
 * over `FADE_IN_MS` via `requestAnimationFrame`.
 *
 * The idle countdown is disarmed until `arm()` (or `hideNow()`) is called.
 * Before that, targets are shown unconditionally and never auto-hide — the
 * setup panel must stay fully visible for as long as the player is still
 * configuring things, however long that takes; only once the show actually
 * starts should idling be able to hide anything.
 */
export class IdleFadeController {
  private readonly targets: Container[];
  private readonly ticker: Ticker;
  private readonly idleMs: number;
  private timer: TickerTimerHandle | undefined;
  private fadeTick: ((t: Ticker) => void) | undefined;
  private armed = false;

  constructor(targets: Container[], ticker: Ticker, idleMs: number = DEFAULT_IDLE_MS) {
    this.targets = targets;
    this.ticker = ticker;
    this.idleMs = idleMs;

    window.addEventListener('pointermove', this.handleActivity);
    window.addEventListener('pointerdown', this.handleActivity);
  }

  /** Starts the idle-hide countdown. Call once the show actually begins. */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    this.resetTimer();
  }

  /**
   * Hides the targets immediately (no fade transition), arming the idle
   * countdown if it wasn't already. Used right when a show starts so the UI
   * never lingers on screen waiting for the normal idle timeout to elapse.
   */
  hideNow(): void {
    this.armed = true;
    this.hide();
    this.resetTimer();
  }

  /**
   * Un-arms the idle countdown and shows the targets immediately — the
   * inverse of `hideNow()`, used when the player explicitly exits a show and
   * returns to the setup/idle state. Until `hideNow()` is called again (the
   * next show start), targets stay fully visible regardless of activity.
   */
  disarmAndShow(): void {
    this.armed = false;
    this.timer?.cancel();
    this.show();
  }

  private handleActivity = (): void => {
    this.show();
    if (this.armed) this.resetTimer();
  };

  private resetTimer(): void {
    this.timer?.cancel();
    if (!this.armed) return;
    this.timer = tickerSetTimeout(this.ticker, () => this.hide(), this.idleMs);
  }

  private stopFade(): void {
    if (this.fadeTick) this.ticker.remove(this.fadeTick);
    this.fadeTick = undefined;
  }

  private show(): void {
    this.stopFade();
    const startAlphas = this.targets.map((target) => {
      target.visible = true;
      return target.alpha;
    });
    let elapsedMs = 0;

    const tick = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / FADE_IN_MS);
      this.targets.forEach((target, i) => {
        target.alpha = startAlphas[i] + (1 - startAlphas[i]) * progress;
      });
      if (progress >= 1) this.stopFade();
    };
    this.fadeTick = tick;
    this.ticker.add(tick);
  }

  private hide(): void {
    this.stopFade();
    for (const target of this.targets) {
      target.visible = false;
      target.alpha = 0;
    }
  }
}
