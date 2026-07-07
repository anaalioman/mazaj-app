import type { Application } from 'pixi.js';
import type { AudioManager } from '../audio/AudioManager';

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
  tap: '🎯 نقر حر',
  mortar: '🚀 حقل المدفع',
};

/** Transparent horizontal bar: branding + FPS (right), input-mode switch (center), media dock (left). */
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
    button.textContent = isRecording ? '⏹' : '🔴';
  }

  private template(): string {
    return `
      <div class="mzj-header-group mzj-header-right">
        <button type="button" id="mzj-home" aria-label="العودة للقائمة الرئيسية">🏠</button>
        <span class="mzj-brand">مزاج 🎆</span>
        <span id="mzj-fps" class="mzj-fps">60 FPS</span>
      </div>
      <div class="mzj-header-group mzj-header-center">
        <button type="button" id="mzj-mode-toggle" class="mzj-mode-toggle">${MODE_LABELS.tap}</button>
      </div>
      <div class="mzj-header-group mzj-header-left">
        <button type="button" id="mzj-mute" aria-label="كتم الصوت">🔊</button>
        <button type="button" id="mzj-snapshot" aria-label="لقطة عالية الدقة">📸</button>
        <button type="button" id="mzj-record" aria-label="تسجيل فيديو">🔴</button>
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
      button.textContent = MODE_LABELS[this.mode];
      button.classList.toggle('mzj-mode-mortar', this.mode === 'mortar');
      this.deps.onModeChange(this.mode);
    });
  }

  private wireMute(): void {
    const button = this.query<HTMLButtonElement>('#mzj-mute');
    button.addEventListener('click', () => {
      const muted = this.deps.audio.toggleMute();
      button.textContent = muted ? '🔇' : '🔊';
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
        label.textContent = `${Math.round(this.deps.app.ticker.FPS)} FPS`;
      }
    });
  }
}
