import type { Container } from 'pixi.js';

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
  private readonly idleMs: number;
  private timer: number | undefined;
  private fadeRaf: number | undefined;
  private armed = false;

  constructor(targets: Container[], idleMs: number = DEFAULT_IDLE_MS) {
    this.targets = targets;
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
    if (this.fadeRaf !== undefined) cancelAnimationFrame(this.fadeRaf);
    const startAlphas = this.targets.map((target) => {
      target.visible = true;
      return target.alpha;
    });
    const start = performance.now();

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / FADE_IN_MS);
      this.targets.forEach((target, i) => {
        target.alpha = startAlphas[i] + (1 - startAlphas[i]) * t;
      });
      if (t < 1) this.fadeRaf = requestAnimationFrame(tick);
    };
    this.fadeRaf = requestAnimationFrame(tick);
  }

  private hide(): void {
    if (this.fadeRaf !== undefined) cancelAnimationFrame(this.fadeRaf);
    for (const target of this.targets) {
      target.visible = false;
      target.alpha = 0;
    }
  }
}
