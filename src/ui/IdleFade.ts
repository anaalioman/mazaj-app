const DEFAULT_IDLE_MS = 5000;

/**
 * Fades a set of UI roots out after a period of no pointer activity anywhere
 * on the page, and instantly brings them back on the next movement/tap.
 * CSS (see mazajUI.css) gives the fade-in a fast transition and the fade-out
 * a slower one via the `.mzj-idle` class.
 *
 * The idle countdown is disarmed until `arm()` (or `hideNow()`) is called.
 * Before that, targets are shown unconditionally and never auto-hide — the
 * setup panel must stay fully visible for as long as the player is still
 * configuring things, however long that takes; only once the show actually
 * starts should idling be able to hide anything.
 */
export class IdleFadeController {
  private readonly targets: HTMLElement[];
  private readonly idleMs: number;
  private timer: number | undefined;
  private armed = false;

  constructor(targets: HTMLElement[], idleMs: number = DEFAULT_IDLE_MS) {
    this.targets = targets;
    this.idleMs = idleMs;

    for (const target of targets) target.classList.add('mzj-fade-target');

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

  private handleActivity = (): void => {
    this.show();
    if (this.armed) this.resetTimer();
  };

  private resetTimer(): void {
    window.clearTimeout(this.timer);
    if (!this.armed) return;
    this.timer = window.setTimeout(() => this.hide(), this.idleMs);
  }

  private show(): void {
    for (const target of this.targets) target.classList.remove('mzj-idle');
  }

  private hide(): void {
    for (const target of this.targets) target.classList.add('mzj-idle');
  }
}
