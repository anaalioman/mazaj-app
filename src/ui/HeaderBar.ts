import type { Application } from 'pixi.js';
import type { AudioManager } from '../audio/AudioManager';
import { icon } from './icons';
import type { LaunchMode } from './PlanningScreen';

export interface HeaderBarDeps {
  app: Application;
  audio: AudioManager;
  onStartShow: () => void;
  onBackToHome: () => void;
  onOpenPlanningScreen: (mode: LaunchMode) => void;
}

/** Transparent horizontal bar: home + start-show + plan (right), FPS + mute (left). */
export class HeaderBar {
  readonly root: HTMLDivElement;
  private readonly deps: HeaderBarDeps;

  constructor(deps: HeaderBarDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-header';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    for (const type of ['pointerdown', 'click'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.wireHome();
    this.wireStartShow();
    this.wireOpenPlanning();
    this.wireMute();
    this.wireFps();
  }

  private template(): string {
    return `
      <div class="mzj-header-group mzj-header-right">
        <button type="button" id="mzj-home" aria-label="العودة للقائمة الرئيسية">${icon('home', 18)}</button>
        <button type="button" id="mzj-start-show" class="mzj-mode-toggle">${icon('play', 15)}<span>ابدأ العرض</span></button>
        <button type="button" id="mzj-open-planning" aria-label="خطة الإطلاق">${icon('mapPin', 18)}</button>
      </div>
      <div class="mzj-header-group mzj-header-left">
        <span id="mzj-fps" class="mzj-fps">60</span>
        <button type="button" id="mzj-mute" aria-label="كتم الصوت">${icon('volume2', 18)}</button>
      </div>
    `;
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private wireHome(): void {
    const button = this.query<HTMLButtonElement>('#mzj-home');
    button.addEventListener('click', () => this.deps.onBackToHome());
  }

  private wireStartShow(): void {
    const button = this.query<HTMLButtonElement>('#mzj-start-show');
    button.addEventListener('click', () => {
      this.deps.onStartShow();
      button.disabled = true;
      button.innerHTML = `${icon('play', 15)}<span>بدأ العرض</span>`;
    });
  }

  private wireOpenPlanning(): void {
    const button = this.query<HTMLButtonElement>('#mzj-open-planning');
    button.addEventListener('click', () => this.deps.onOpenPlanningScreen('mass'));
  }

  private wireMute(): void {
    const button = this.query<HTMLButtonElement>('#mzj-mute');
    button.addEventListener('click', () => {
      const muted = this.deps.audio.toggleMute();
      button.innerHTML = icon(muted ? 'volumeX' : 'volume2', 18);
    });
  }

  private wireFps(): void {
    const label = this.query<HTMLSpanElement>('#mzj-fps');
    let frame = 0;
    this.deps.app.ticker.add(() => {
      frame++;
      if (frame % 15 === 0) {
        label.textContent = `${Math.round(this.deps.app.ticker.FPS)}`;
      }
    });
  }
}
