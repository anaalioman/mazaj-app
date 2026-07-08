import type { Application } from 'pixi.js';
import type { AudioManager } from '../audio/AudioManager';
import { icon, type IconName } from './icons';

export type InputMode = 'tap' | 'mortar';

export interface HeaderBarDeps {
  app: Application;
  audio: AudioManager;
  onModeChange: (mode: InputMode) => void;
  onSnapshot: () => void;
  onToggleRecording: () => void;
  onBackToHome: () => void;
}

const MODE_LABELS: Record<InputMode, string> = {
  tap: 'حر',
  mortar: 'مدفع',
};

const MODE_ICONS: Record<InputMode, IconName> = {
  tap: 'target',
  mortar: 'rocket',
};

/** Transparent horizontal bar: home (right), input-mode switch (center), media dock (left). */
export class HeaderBar {
  readonly root: HTMLDivElement;
  private readonly deps: HeaderBarDeps;
  private mode: InputMode = 'tap';

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
    this.wireModeToggle();
    this.wireMute();
    this.wireSnapshot();
    this.wireRecording();
    this.wireFps();
  }

  /** Called by main.ts once a recording actually starts/stops, to sync the icon. */
  setRecordingState(isRecording: boolean): void {
    const button = this.query<HTMLButtonElement>('#mzj-record');
    button.classList.toggle('mzj-recording', isRecording);
    button.innerHTML = icon(isRecording ? 'squareStop' : 'recordDot', 18);
  }

  private template(): string {
    return `
      <div class="mzj-header-group mzj-header-right">
        <button type="button" id="mzj-home" aria-label="العودة للقائمة الرئيسية">${icon('home', 18)}</button>
      </div>
      <div class="mzj-header-group mzj-header-center">
        <button type="button" id="mzj-mode-toggle" class="mzj-mode-toggle">
          ${icon(MODE_ICONS.tap, 16)}<span>${MODE_LABELS.tap}</span>
        </button>
      </div>
      <div class="mzj-header-group mzj-header-left">
        <span id="mzj-fps" class="mzj-fps">60</span>
        <button type="button" id="mzj-mute" aria-label="كتم الصوت">${icon('volume2', 18)}</button>
        <button type="button" id="mzj-snapshot" aria-label="لقطة عالية الدقة">${icon('camera', 18)}</button>
        <button type="button" id="mzj-record" aria-label="تسجيل فيديو">${icon('recordDot', 18)}</button>
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

  private wireModeToggle(): void {
    const button = this.query<HTMLButtonElement>('#mzj-mode-toggle');
    button.addEventListener('click', () => {
      this.mode = this.mode === 'tap' ? 'mortar' : 'tap';
      button.innerHTML = `${icon(MODE_ICONS[this.mode], 16)}<span>${MODE_LABELS[this.mode]}</span>`;
      button.classList.toggle('mzj-mode-mortar', this.mode === 'mortar');
      this.deps.onModeChange(this.mode);
    });
  }

  private wireMute(): void {
    const button = this.query<HTMLButtonElement>('#mzj-mute');
    button.addEventListener('click', () => {
      const muted = this.deps.audio.toggleMute();
      button.innerHTML = icon(muted ? 'volumeX' : 'volume2', 18);
    });
  }

  private wireSnapshot(): void {
    const button = this.query<HTMLButtonElement>('#mzj-snapshot');
    button.addEventListener('click', () => this.deps.onSnapshot());
  }

  private wireRecording(): void {
    const button = this.query<HTMLButtonElement>('#mzj-record');
    const canRecord = typeof MediaRecorder !== 'undefined' && typeof this.deps.app.canvas.captureStream === 'function';
    if (!canRecord) {
      button.disabled = true;
      button.title = 'تسجيل الفيديو غير مدعوم في هذا المتصفح';
      return;
    }
    button.addEventListener('click', () => this.deps.onToggleRecording());
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
