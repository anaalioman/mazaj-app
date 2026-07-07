import { ALL_BURST_TYPES, type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer, BackgroundPreset } from '../background';
import type { GlowFrame, GlowFrameShape } from '../effects/GlowFrame';

export interface BottomDashboardDeps {
  fireworks: FireworksSystem;
  background: BackgroundLayer;
  glowFrame: GlowFrame;
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
  density: { id: 'mzj-density', label: 'كثافة الجسيمات', min: 50, max: 500, step: 1, value: 150 },
  gravity: { id: 'mzj-gravity', label: 'شدة الجاذبية', min: 0, max: 2, step: 0.05, value: 1 },
  lifespan: { id: 'mzj-lifespan', label: 'عمر الجسيمات', min: 0.4, max: 2.5, step: 0.05, value: 1 },
  scale: { id: 'mzj-scale', label: 'اتساع الانفجار', min: 0.5, max: 2, step: 0.05, value: 1 },
  glow: { id: 'mzj-glow', label: 'توهج النيون', min: 0, max: 10, step: 0.5, value: 2 },
  dimmer: { id: 'mzj-dimmer', label: 'إضاءة الخلفية', min: 0, max: 1, step: 0.01, value: 1 },
} satisfies Record<string, SliderSpec>;

const BURST_LABELS: Record<BurstType, string> = {
  peony: '🌸 بيوني',
  rose: '🌹 وردة',
  kamuro: '✨ كامورو ذهبي',
  crossette: '✚ كروسيت',
};

const PRESETS: { id: BackgroundPreset; label: string }[] = [
  { id: 'none', label: '✨ نجوم فقط' },
  { id: 'city', label: '🏙️ أفق مدينة' },
  { id: 'mountains', label: '⛰️ جبال' },
];

/** Compact tabbed glass dashboard anchored at the bottom-center of the screen. */
export class BottomDashboard {
  readonly root: HTMLDivElement;
  private readonly deps: BottomDashboardDeps;
  private readonly activeBurstTypes = new Set<BurstType>(ALL_BURST_TYPES);
  private autoShowEnabled = true;

  constructor(deps: BottomDashboardDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-dashboard';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.wireTabs();
    this.wireBurstToggles();
    this.wireAutoShow();
    this.wirePresets();
    this.wireMedia();
    this.wireSliders();
    this.wireGreeting();
  }

  private template(): string {
    return `
      <nav class="mzj-tabs">
        <button type="button" class="mzj-tab active" data-tab="patterns">الأنماط 🌀</button>
        <button type="button" class="mzj-tab" data-tab="environment">البيئة 🏙️</button>
        <button type="button" class="mzj-tab" data-tab="messages">الرسائل ✍️</button>
        <button type="button" class="mzj-tab" data-tab="lab">المختبر ⚙️</button>
      </nav>

      <div class="mzj-tab-panels">
        <section class="mzj-tab-content active" data-panel="patterns">
          <div class="mcp-burst-grid">
            ${ALL_BURST_TYPES.map(
              (type) => `<button type="button" class="mcp-burst-btn" data-type="${type}">${BURST_LABELS[type]}</button>`,
            ).join('')}
          </div>
          <button type="button" id="mzj-auto-show" class="mcp-primary-btn active">العرض التلقائي: يعمل</button>
        </section>

        <section class="mzj-tab-content" data-panel="environment">
          <div class="mzj-preset-grid">
            ${PRESETS.map(
              (p) => `<button type="button" class="mzj-preset-btn${p.id === 'none' ? ' active' : ''}" data-preset="${p.id}">${p.label}</button>`,
            ).join('')}
          </div>
          <label class="mcp-field">
            <span>رفع صورة خلفية</span>
            <input type="file" id="mzj-bg-image" accept="image/*" />
          </label>
          <label class="mcp-field">
            <span>رفع فيديو خلفية حي</span>
            <input type="file" id="mzj-bg-video" accept="video/*" />
          </label>
          ${this.sliderRow(SLIDERS.dimmer)}
        </section>

        <section class="mzj-tab-content" data-panel="messages">
          <label class="mcp-field">
            <span>نص التهنئة</span>
            <input type="text" id="mzj-greeting-text" placeholder="مبروك" maxlength="40" />
          </label>
          <label class="mcp-field">
            <span>شكل الإطار المتوهج</span>
            <select id="mzj-frame-shape">
              <option value="heart">♥ قلب</option>
              <option value="star">★ نجمة</option>
              <option value="circle">◯ هالة</option>
            </select>
          </label>
          <button type="button" id="mzj-greeting-apply" class="mcp-primary-btn">أضف العبارة ✨</button>
        </section>

        <section class="mzj-tab-content" data-panel="lab">
          ${this.sliderRow(SLIDERS.density)}
          ${this.sliderRow(SLIDERS.gravity)}
          ${this.sliderRow(SLIDERS.lifespan)}
          ${this.sliderRow(SLIDERS.scale)}
          ${this.sliderRow(SLIDERS.glow)}
        </section>
      </div>
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

  private wireTabs(): void {
    const tabs = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mzj-tab'));
    const panels = Array.from(this.root.querySelectorAll<HTMLElement>('.mzj-tab-content'));

    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        for (const t of tabs) t.classList.toggle('active', t === tab);
        for (const panel of panels) panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab);
      });
    }
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

  private wireAutoShow(): void {
    const button = this.query<HTMLButtonElement>('#mzj-auto-show');
    button.addEventListener('click', () => {
      this.autoShowEnabled = !this.autoShowEnabled;
      this.deps.fireworks.setAutoLaunch(this.autoShowEnabled);
      button.classList.toggle('active', this.autoShowEnabled);
      button.textContent = this.autoShowEnabled ? 'العرض التلقائي: يعمل' : 'العرض التلقائي: متوقف';
    });
  }

  private wirePresets(): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mzj-preset-btn'));
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        for (const b of buttons) b.classList.toggle('active', b === btn);
        this.deps.background.setPreset(btn.dataset.preset as BackgroundPreset);
      });
    }
  }

  private wireMedia(): void {
    const imageInput = this.query<HTMLInputElement>('#mzj-bg-image');
    const videoInput = this.query<HTMLInputElement>('#mzj-bg-video');

    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) void this.deps.background.setImage(file);
    });

    videoInput.addEventListener('change', () => {
      const file = videoInput.files?.[0];
      if (file) void this.deps.background.setVideo(file);
    });
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

  private wireGreeting(): void {
    const textInput = this.query<HTMLInputElement>('#mzj-greeting-text');
    const shapeSelect = this.query<HTMLSelectElement>('#mzj-frame-shape');
    const applyBtn = this.query<HTMLButtonElement>('#mzj-greeting-apply');
    applyBtn.addEventListener('click', () => {
      this.deps.glowFrame.show(textInput.value, shapeSelect.value as GlowFrameShape);
    });
  }
}
