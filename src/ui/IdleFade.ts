import type { Container, Ticker } from 'pixi.js';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';

const DEFAULT_IDLE_MS = 5000;
/** Fading back in eases over this long. */
const FADE_IN_MS = 180;
/**
 * Hiding also eases now, over the same duration as fading in — but
 * `eventMode` flips to `'none'` (see hide()) at the very first tick, not at
 * the end: the fade is purely cosmetic, it must not leave the header
 * tappable/hit-testable for the length of the fade, which would let an
 * early tap on the fireworks canvas underneath get swallowed by a
 * still-interactive, semi-transparent button instead.
 */
const FADE_OUT_MS = 180;

/**
 * Fades a set of Pixi containers out after a period of no pointer activity
 * anywhere on the page, and instantly brings them back on the next
 * movement/tap. Both directions ease `alpha` via the shared Ticker; hiding
 * additionally sets `eventMode = 'none'` the instant the fade starts (not
 * once it finishes) so the header stops intercepting taps immediately even
 * though it's still fading out, and only sets `visible = false` once fully
 * transparent (a genuinely zero-cost, zero-hit-testable rest state, not
 * just alpha 0 forever).
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
   * Fades the targets out (see hide()) right away rather than waiting for
   * the normal idle timeout, arming the idle countdown if it wasn't already.
   * Used right when a show starts so the UI doesn't linger on screen for the
   * length of the idle timeout — it still becomes non-interactive
   * immediately either way (see hide()'s own doc comment), only the visual
   * fade itself takes FADE_OUT_MS.
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
      // 'passive': does not emit/hit-test itself but still lets its own
      // interactive children (each button sets its own eventMode='static')
      // respond — Pixi's own default for a plain wrapping container, and
      // what these targets had before hide() touched it.
      target.eventMode = 'passive';
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
    // Non-interactive from the very first tick of the fade, not once it
    // finishes — see this class's own doc comment on why.
    for (const target of this.targets) target.eventMode = 'none';
    const startAlphas = this.targets.map((target) => target.alpha);
    let elapsedMs = 0;

    const tick = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / FADE_OUT_MS);
      this.targets.forEach((target, i) => {
        target.alpha = startAlphas[i] * (1 - progress);
      });
      if (progress < 1) return;
      this.stopFade();
      for (const target of this.targets) target.visible = false;
    };
    this.fadeTick = tick;
    this.ticker.add(tick);
  }
}
