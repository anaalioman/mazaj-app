import type { Application } from 'pixi.js';
import { ALL_BURST_TYPES, type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import { GlowFrame, type GlowFrameShape } from '../effects/GlowFrame';
import { downloadBlob, type RecordingManager } from '../recording/RecordingManager';

export interface ControlPanelDeps {
  app: Application;
  fireworks: FireworksSystem;
  background: BackgroundLayer;
  glowFrame: GlowFrame;
  recording: RecordingManager;
}

interface SliderSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

const SLIDERS = {
  density: { id: 'mcp-density', label: 'كثافة الجسيمات', min: 50, max: 500, step: 1, value: 150 },
  gravity: { id: 'mcp-gravity', label: 'شدة الجاذبية', min: 0, max: 2, step: 0.05, value: 1 },
  lifespan: { id: 'mcp-lifespan', label: 'عمر الجسيمات', min: 0.4, max: 2.5, step: 0.05, value: 1 },
  scale: { id: 'mcp-scale', label: 'اتساع الانفجار', min: 0.5, max: 2, step: 0.05, value: 1 },
  glow: { id: 'mcp-glow', label: 'توهج النيون', min: 0, max: 10, step: 0.5, value: 2 },
  dimmer: { id: 'mcp-dimmer', label: 'إضاءة الخلفية', min: 0, max: 1, step: 0.01, value: 1 },
} satisfies Record<string, SliderSpec>;

const BURST_LABELS: Record<BurstType, string> = {
  peony: '🌸 بيوني',
  rose: '🌹 وردة',
  kamuro: '✨ كامورو ذهبي',
  crossette: '✚ كروسيت',
};

const CHRONO_CLIP_MS = 8000;

/** Floating glassmorphism control panel wired directly into the live show. */
export class ControlPanel {
  private readonly deps: ControlPanelDeps;
  private readonly root: HTMLDivElement;
  private readonly activeBurstTypes = new Set<BurstType>(ALL_BURST_TYPES);
  private selectedShape: GlowFrameShape = 'heart';

  constructor(deps: ControlPanelDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mcp-root';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    // Explicit per spec: nothing inside the panel should ever reach the
    // PixiJS stage's own pointerdown/launch handler.
    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.wireToggle();
    this.wireBurstToggles();
    this.wireSliders();
    this.wireMedia();
    this.wireGreeting();
    this.wireSnapshot();
    this.wireChronoRecorder();
  }

  private template(): string {
    return `
      <button id="mcp-tab" type="button" aria-label="لوحة التحكم">🎛</button>
      <aside id="mcp-panel">
        <header class="mcp-header">
          <h2>لوحة تحكم العرض</h2>
          <button id="mcp-close" type="button" aria-label="إغلاق">✕</button>
        </header>

        <section class="mcp-section">
          <h3>أنماط الانفجار</h3>
          <div class="mcp-burst-grid">
            ${ALL_BURST_TYPES.map(
              (type) => `<button type="button" class="mcp-burst-btn" data-type="${type}">${BURST_LABELS[type]}</button>`,
            ).join('')}
          </div>
        </section>

        <section class="mcp-section">
          <h3>الفيزياء والهندسة</h3>
          ${this.sliderRow(SLIDERS.density)}
          ${this.sliderRow(SLIDERS.gravity)}
          ${this.sliderRow(SLIDERS.lifespan)}
          ${this.sliderRow(SLIDERS.scale)}
          ${this.sliderRow(SLIDERS.glow)}
        </section>

        <section class="mcp-section">
          <h3>الخلفية والإضاءة</h3>
          <label class="mcp-field">
            <span>رفع صورة خلفية</span>
            <input type="file" id="mcp-bg-image" accept="image/*" />
          </label>
          <label class="mcp-field">
            <span>رفع فيديو خلفية حي</span>
            <input type="file" id="mcp-bg-video" accept="video/*" />
          </label>
          ${this.sliderRow(SLIDERS.dimmer)}
        </section>

        <section class="mcp-section">
          <h3>مشاركة اللحظة والتسجيل</h3>
          <label class="mcp-field">
            <span>نص التهنئة</span>
            <input type="text" id="mcp-greeting-text" placeholder="مبروك" maxlength="40" />
          </label>
          <div class="mcp-frame-grid">
            <button type="button" class="mcp-frame-btn" data-shape="heart">♥ قلب</button>
            <button type="button" class="mcp-frame-btn" data-shape="star">★ نجمة</button>
            <button type="button" class="mcp-frame-btn" data-shape="circle">◯ هالة</button>
          </div>
          <button type="button" id="mcp-greeting-apply" class="mcp-primary-btn">أضف العبارة ✨</button>

          <div class="mcp-actions">
            <button type="button" id="mcp-snapshot" class="mcp-primary-btn">📸 لقطة عالية الدقة</button>
            <button type="button" id="mcp-chrono" class="mcp-primary-btn">
              🎥 لقطة سريعة (٨ ثوانٍ)
              <span id="mcp-chrono-dot" class="mcp-rec-dot mcp-hidden"></span>
            </button>
          </div>
        </section>
      </aside>
      <div id="mcp-flash" class="mcp-hidden"></div>
    `;
  }

  private sliderRow(spec: SliderSpec): string {
    return `
      <div class="mcp-slider-row">
        <label for="${spec.id}">${spec.label}</label>
        <input type="range" id="${spec.id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" />
        <output id="${spec.id}-out" for="${spec.id}">${spec.value}</output>
      </div>
    `;
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private wireToggle(): void {
    const tab = this.query<HTMLButtonElement>('#mcp-tab');
    const panel = this.query<HTMLDivElement>('#mcp-panel');
    const close = this.query<HTMLButtonElement>('#mcp-close');

    tab.addEventListener('click', () => panel.classList.toggle('mcp-open'));
    close.addEventListener('click', () => panel.classList.remove('mcp-open'));
  }

  private wireBurstToggles(): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mcp-burst-btn'));

    const sync = () => {
      for (const btn of buttons) {
        const type = btn.dataset.type as BurstType;
        btn.classList.toggle('active', this.activeBurstTypes.has(type));
      }
      this.deps.fireworks.setEnabledTypes(Array.from(this.activeBurstTypes));
    };

    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type as BurstType;
        if (this.activeBurstTypes.has(type)) {
          // Always keep at least one shell type selectable.
          if (this.activeBurstTypes.size > 1) this.activeBurstTypes.delete(type);
        } else {
          this.activeBurstTypes.add(type);
        }
        sync();
      });
    }

    sync();
  }

  private wireSliders(): void {
    this.bindSlider(SLIDERS.density.id, (v) => this.deps.fireworks.updateSettings({ particleDensity: v }));
    this.bindSlider(SLIDERS.gravity.id, (v) => this.deps.fireworks.updateSettings({ gravityScale: v }));
    this.bindSlider(SLIDERS.lifespan.id, (v) => this.deps.fireworks.updateSettings({ lifespanScale: v }));
    this.bindSlider(SLIDERS.scale.id, (v) => this.deps.fireworks.updateSettings({ explosionScale: v }));
    this.bindSlider(SLIDERS.glow.id, (v) => this.deps.fireworks.updateSettings({ glow: v }));
    this.bindSlider(SLIDERS.dimmer.id, (v) => this.deps.background.setDimmer(v));
  }

  private bindSlider(id: string, onChange: (value: number) => void): void {
    const input = this.query<HTMLInputElement>(`#${id}`);
    const output = this.query<HTMLOutputElement>(`#${id}-out`);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = String(value);
      onChange(value);
    });
  }

  private wireMedia(): void {
    const imageInput = this.query<HTMLInputElement>('#mcp-bg-image');
    const videoInput = this.query<HTMLInputElement>('#mcp-bg-video');

    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) void this.deps.background.setImage(file);
    });

    videoInput.addEventListener('change', () => {
      const file = videoInput.files?.[0];
      if (file) void this.deps.background.setVideo(file);
    });
  }

  private wireGreeting(): void {
    const shapeButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mcp-frame-btn'));
    const syncShape = () => {
      for (const btn of shapeButtons) {
        btn.classList.toggle('active', btn.dataset.shape === this.selectedShape);
      }
    };
    for (const btn of shapeButtons) {
      btn.addEventListener('click', () => {
        this.selectedShape = btn.dataset.shape as GlowFrameShape;
        syncShape();
      });
    }
    syncShape();

    const textInput = this.query<HTMLInputElement>('#mcp-greeting-text');
    const applyBtn = this.query<HTMLButtonElement>('#mcp-greeting-apply');
    applyBtn.addEventListener('click', () => {
      this.deps.glowFrame.show(textInput.value, this.selectedShape);
    });
  }

  private wireSnapshot(): void {
    const button = this.query<HTMLButtonElement>('#mcp-snapshot');
    if (typeof this.deps.app.renderer.extract?.base64 !== 'function') {
      button.disabled = true;
      button.title = 'التقاط اللقطات غير مدعوم في هذا المتصفح';
      return;
    }
    button.addEventListener('click', () => void this.takeSnapshot());
  }

  private async takeSnapshot(): Promise<void> {
    this.flashScreen();
    try {
      const { app } = this.deps;
      const dataUrl = await app.renderer.extract.base64({
        target: app.stage,
        resolution: Math.min(app.renderer.resolution * 1.5, 3),
      });

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `mazaj-snapshot-${Date.now()}.png`;
      link.click();
    } catch (error) {
      console.error('تعذّر التقاط اللقطة:', error);
    }
  }

  private flashScreen(): void {
    const flash = this.query<HTMLDivElement>('#mcp-flash');
    flash.classList.remove('mcp-hidden');
    flash.style.transition = 'none';
    flash.style.opacity = '1';
    void flash.offsetWidth; // force reflow so the fade-out transition below actually animates
    flash.style.transition = 'opacity 400ms ease-out';
    flash.style.opacity = '0';

    window.setTimeout(() => {
      flash.classList.add('mcp-hidden');
      flash.style.transition = '';
    }, 420);
  }

  private wireChronoRecorder(): void {
    const button = this.query<HTMLButtonElement>('#mcp-chrono');
    const dot = this.query<HTMLSpanElement>('#mcp-chrono-dot');
    const { recording } = this.deps;

    const canRecord = typeof MediaRecorder !== 'undefined' && typeof this.deps.app.canvas.captureStream === 'function';
    if (!canRecord) {
      button.disabled = true;
      button.title = 'تسجيل الفيديو غير مدعوم في هذا المتصفح';
      return;
    }

    button.addEventListener('click', () => {
      if (recording.isRecording) return; // a manual or chrono recording is already running

      try {
        recording.start();
      } catch (error) {
        console.error('تعذّر بدء اللقطة السريعة:', error);
        return;
      }

      button.disabled = true;
      dot.classList.remove('mcp-hidden');

      window.setTimeout(async () => {
        try {
          const blob = await recording.stop();
          downloadBlob(blob, `mazaj-highlight-${Date.now()}.webm`);
        } catch (error) {
          console.error('تعذّر إنهاء اللقطة السريعة:', error);
        } finally {
          button.disabled = false;
          dot.classList.add('mcp-hidden');
        }
      }, CHRONO_CLIP_MS);
    });
  }
}
