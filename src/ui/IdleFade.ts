const DEFAULT_IDLE_MS = 5000;

/**
 * Fades a set of UI roots out after a period of no pointer activity anywhere
 * on the page, and instantly brings them back on the next movement/tap.
 * CSS (see mazajUI.css) gives the fade-in a fast transition and the fade-out
 * a slower one via the `.mzj-idle` class.
 */
export class IdleFadeController {
  private readonly targets: HTMLElement[];
  private readonly idleMs: number;
  private timer: number | undefined;

  constructor(targets: HTMLElement[], idleMs: number = DEFAULT_IDLE_MS) {
    this.targets = targets;
    this.idleMs = idleMs;

    for (const target of targets) target.classList.add('mzj-fade-target');

    window.addEventListener('pointermove', this.handleActivity);
    window.addEventListener('pointerdown', this.handleActivity);
    this.resetTimer();
  }

  private handleActivity = (): void => {
    this.show();
    this.resetTimer();
  };

  private resetTimer(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), this.idleMs);
  }

  private show(): void {
    for (const target of this.targets) target.classList.remove('mzj-idle');
  }

  private hide(): void {
    for (const target of this.targets) target.classList.add('mzj-idle');
  }
}
