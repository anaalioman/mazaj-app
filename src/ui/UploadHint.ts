const STORAGE_KEY = 'mzj-upload-hint-shown';
const VISIBLE_MS = 3000;

const MESSAGES = {
  image: 'تحكم بوهج الإضاءة عبر شريط التحكم للحفاظ على جودة الصورة.',
  video: 'تحكم بوهج الإضاءة عبر شريط التحكم للحفاظ على جودة وتفاصيل الفيديو.',
};

/**
 * A one-time floating hint, shown for 3s the first time the player uploads a
 * background image or video, pointing them toward the fireworks-glow slider
 * (via a brief highlight pulse on that slider's row) so the glow doesn't
 * wash out their photo/video. Never shown again after the first time
 * (localStorage), on this or any future upload.
 */
export class UploadHint {
  private readonly toast: HTMLDivElement;
  private readonly glowRow: Element | null;
  private hideTimer: number | null = null;

  constructor(dashboardRoot: HTMLElement) {
    this.toast = document.createElement('div');
    this.toast.id = 'mzj-upload-hint';
    this.toast.className = 'mzj-upload-hint';
    document.body.appendChild(this.toast);
    this.glowRow = dashboardRoot.querySelector('#mzj-glow')?.closest('.mcp-slider-row') ?? null;
  }

  show(kind: keyof typeof MESSAGES): void {
    if (this.hasShownBefore()) return;

    this.toast.textContent = `✨ ${MESSAGES[kind]}`;
    this.toast.classList.add('mzj-upload-hint-visible');
    this.glowRow?.classList.add('mzj-glow-row-pulse');

    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.toast.classList.remove('mzj-upload-hint-visible');
      this.glowRow?.classList.remove('mzj-glow-row-pulse');
    }, VISIBLE_MS);

    this.markShown();
  }

  private hasShownBefore(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false; // localStorage unavailable — just show it rather than crash
    }
  }

  private markShown(): void {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // best-effort only
    }
  }
}
