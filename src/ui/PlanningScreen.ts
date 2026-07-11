import { icon } from './icons';

export type LaunchMode = 'mass' | 'sequential';

const HINT_VISIBLE_MS = 2600;

/**
 * Full-screen planning layout shown after the player picks "إطلاق جماعي" or
 * "إطلاق متتابع" from the main panel. This build is structure/display only:
 * it shows the two-sided icon layout and a briefly-visible instructional
 * hint. Tapping a side icon or the empty middle area does nothing yet —
 * that's for the next batch (actual location-picking logic).
 */
export class PlanningScreen {
  readonly root: HTMLDivElement;
  private hintTimer: number | undefined;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'mzj-planning-screen';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    for (const type of ['pointerdown', 'click'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  show(mode: LaunchMode): void {
    this.root.dataset.mode = mode;
    this.root.classList.remove('mzj-hidden');

    const hint = this.root.querySelector<HTMLDivElement>('#mzj-planning-hint')!;
    hint.classList.remove('mzj-planning-hint-hidden');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => hint.classList.add('mzj-planning-hint-hidden'), HINT_VISIBLE_MS);
  }

  hide(): void {
    this.root.classList.add('mzj-hidden');
    window.clearTimeout(this.hintTimer);
  }

  private template(): string {
    return `
      <div class="mzj-planning-hint" id="mzj-planning-hint">اختر الشكل وحدد موقعه</div>
      <div class="mzj-planning-side mzj-planning-side-right">
        ${this.iconButton('peony', 'بيوني بقلب')}
        ${this.iconButton('rose', 'وردة')}
        ${this.iconButton('kamuro', 'كامورو ذهبي')}
        ${this.iconButton('camera', 'وثّق')}
      </div>
      <div class="mzj-planning-side mzj-planning-side-left">
        ${this.iconButton('crossette', 'كروسيت نخلة')}
        ${this.iconButton('multiRing', 'حلقات متعددة')}
        ${this.iconButton('strobe', 'وميض متلألئ')}
        <button type="button" class="mzj-planning-icon-btn"><span class="mzj-planning-text-icon">T</span><span>نص</span></button>
      </div>
    `;
  }

  private iconButton(name: Parameters<typeof icon>[0], label: string): string {
    return `<button type="button" class="mzj-planning-icon-btn">${icon(name, 22)}<span>${label}</span></button>`;
  }
}
