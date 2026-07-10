import { ALL_BURST_TYPES, type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import type { GlowFrame, GlowFrameShape } from '../effects/GlowFrame';
import { icon } from './icons';
import { UploadHint } from './UploadHint';
import type { PlanningMode } from './PlanningMode';
import { wireFilePickerLabel } from './filePicker';

export interface BottomDashboardDeps {
  fireworks: FireworksSystem;
  background: BackgroundLayer;
  glowFrame: GlowFrame;
  planningMode: PlanningMode;
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
  glow: { id: 'mzj-glow', label: 'توهج الألعاب النارية', min: 0, max: 10, step: 0.5, value: 2 },
  dimmer: { id: 'mzj-dimmer', label: 'إضاءة الخلفية', min: 0, max: 1, step: 0.01, value: 1 },
} satisfies Record<string, SliderSpec>;

const BURST_LABELS: Record<BurstType, string> = {
  peony: 'بيوني بقلب',
  rose: 'وردة',
  kamuro: 'كامورو ذهبي',
  crossette: 'كروسيت نخلة',
  multiRing: 'حلقات متعددة',
  strobe: 'وميض متلألئ',
};

/** Compact tabbed glass dashboard anchored at the bottom-center of the screen. */
export class BottomDashboard {
  readonly root: HTMLDivElement;
  private readonly deps: BottomDashboardDeps;
  private readonly activeBurstTypes = new Set<BurstType>(ALL_BURST_TYPES);
  private readonly uploadHint: UploadHint;
  // Off by default: "ابدأ العرض" should only arm manual tap-to-fire, not
  // also kick off an endless random auto-launch loop the player never asked for.
  private autoShowEnabled = false;

  constructor(deps: BottomDashboardDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-dashboard';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.uploadHint = new UploadHint(this.root);

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.wireTabs();
    this.wireBurstToggles();
    this.wireRandomMode();
    this.wireGroundFountainMode();
    this.wirePlanningMode();
    this.wireAutoShow();
    this.wireMedia();
    this.wireSliders();
    this.wireGreeting();
  }

  private template(): string {
    return `
      <nav class="mzj-tabs">
        <button type="button" class="mzj-tab active" data-tab="patterns">${icon('shapes', 14)}<span>الأنماط</span></button>
        <button type="button" class="mzj-tab" data-tab="environment">${icon('mountain', 14)}<span>البيئة</span></button>
        <button type="button" class="mzj-tab" data-tab="messages">${icon('messageSquare', 14)}<span>الرسائل</span></button>
        <button type="button" class="mzj-tab" data-tab="lab">${icon('sliders', 14)}<span>المختبر</span></button>
      </nav>

      <div class="mzj-tab-panels">
        <section class="mzj-tab-content active" data-panel="patterns">
          <div class="mcp-burst-grid">
            ${ALL_BURST_TYPES.map(
              (type) =>
                `<button type="button" class="mcp-burst-btn" data-type="${type}"><span class="mcp-burst-preview">${icon(type, 20)}</span><span class="mcp-burst-label">${BURST_LABELS[type]}</span></button>`,
            ).join('')}
          </div>
          <div class="mcp-btn-row">
            <button type="button" id="mzj-random-mode" class="mcp-primary-btn">${icon('shuffle', 14)}<span>توليد عشوائي هجين</span></button>
            <button type="button" id="mzj-ground-fountain" class="mcp-primary-btn">${icon('groundFountain', 14)}<span>نافورة أرضية</span></button>
          </div>
          <div class="mcp-btn-row">
            <button type="button" id="mzj-planning-mode" class="mcp-primary-btn">${icon('mapPin', 14)}<span>التخطيط الزمني</span></button>
            <div class="mzj-toggle-row">
              <span>جماعي</span>
              <label class="mzj-switch">
                <input type="checkbox" id="mzj-sequential-toggle" />
                <span class="mzj-switch-track"></span>
              </label>
              <span>متتابع</span>
            </div>
          </div>
          <div class="mcp-btn-row">
            <button type="button" id="mzj-launch-plan" class="mcp-primary-btn">${icon('play', 14)}<span>إطلاق العرض المخطط</span></button>
            <button type="button" id="mzj-auto-show" class="mcp-primary-btn">${icon('fireworksMood', 14)}<span>العرض التلقائي: متوقف</span></button>
          </div>
        </section>

        <section class="mzj-tab-content" data-panel="environment">
          <div class="mcp-field-row">
            <label class="mcp-field">
              <span>رفع صورة خلفية</span>
              <span class="mzj-file-picker">
                <span class="mzj-file-picker-name" id="mzj-bg-image-name">لم يتم اختيار صورة</span>
                <span class="mzj-file-picker-btn">استعراض</span>
              </span>
              <input type="file" id="mzj-bg-image" accept="image/*" class="mzj-file-input-sr" />
            </label>
            <label class="mcp-field">
              <span>رفع فيديو خلفية حي</span>
              <span class="mzj-file-picker">
                <span class="mzj-file-picker-name" id="mzj-bg-video-name">لم يتم اختيار فيديو</span>
                <span class="mzj-file-picker-btn">استعراض</span>
              </span>
              <input type="file" id="mzj-bg-video" accept="video/*" class="mzj-file-input-sr" />
            </label>
          </div>
          ${this.sliderRow(SLIDERS.dimmer)}
          ${this.sliderRow(SLIDERS.glow)}
        </section>

        <section class="mzj-tab-content" data-panel="messages">
          <label class="mcp-field">
            <span>نص التهنئة</span>
            <input type="text" id="mzj-greeting-text" placeholder="مبروك" maxlength="40" />
          </label>
          <div class="mcp-btn-row">
            <select id="mzj-frame-shape" class="mcp-inline-select">
              <option value="heart">♥ قلب</option>
              <option value="star">★ نجمة</option>
              <option value="circle">◯ هالة</option>
            </select>
            <button type="button" id="mzj-greeting-apply" class="mcp-primary-btn">${icon('sparkles', 14)}<span>أضف العبارة</span></button>
          </div>
        </section>

        <section class="mzj-tab-content" data-panel="lab">
          ${this.sliderRow(SLIDERS.density)}
          ${this.sliderRow(SLIDERS.gravity)}
          ${this.sliderRow(SLIDERS.lifespan)}
          ${this.sliderRow(SLIDERS.scale)}
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

  private wireRandomMode(): void {
    const button = this.query<HTMLButtonElement>('#mzj-random-mode');
    const burstButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.mcp-burst-btn'));
    let enabled = false;

    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setRandomMode(enabled);
      button.classList.toggle('active', enabled);
      button.innerHTML = `${icon('shuffle', 14)}<span>${enabled ? 'التوليد العشوائي: يعمل' : 'توليد عشوائي هجين'}</span>`;
      // The individual shell toggles are meaningless while the randomizer
      // is picking freely across every pattern, so grey them out.
      for (const btn of burstButtons) btn.disabled = enabled;
    });
  }

  private wireGroundFountainMode(): void {
    const button = this.query<HTMLButtonElement>('#mzj-ground-fountain');
    let enabled = false;

    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setGroundFountainMode(enabled);
      button.classList.toggle('active', enabled);
    });
  }

  private wirePlanningMode(): void {
    const toggleButton = this.query<HTMLButtonElement>('#mzj-planning-mode');
    const sequentialCheckbox = this.query<HTMLInputElement>('#mzj-sequential-toggle');
    const launchButton = this.query<HTMLButtonElement>('#mzj-launch-plan');

    toggleButton.addEventListener('click', () => {
      const enabled = !this.deps.planningMode.isActive;
      this.deps.planningMode.setActive(enabled);
      toggleButton.classList.toggle('active', enabled);
      if (!enabled) this.deps.planningMode.clear();
    });

    sequentialCheckbox.addEventListener('change', () => {
      this.deps.planningMode.setSequential(sequentialCheckbox.checked);
    });

    launchButton.addEventListener('click', () => {
      this.deps.planningMode.launch();
    });
  }

  private wireAutoShow(): void {
    const button = this.query<HTMLButtonElement>('#mzj-auto-show');
    const label = button.querySelector('span')!;
    button.addEventListener('click', () => {
      this.autoShowEnabled = !this.autoShowEnabled;
      this.deps.fireworks.setAutoLaunch(this.autoShowEnabled);
      button.classList.toggle('active', this.autoShowEnabled);
      label.textContent = this.autoShowEnabled ? 'العرض التلقائي: يعمل' : 'العرض التلقائي: متوقف';
    });
  }

  private wireMedia(): void {
    const imageInput = this.query<HTMLInputElement>('#mzj-bg-image');
    const videoInput = this.query<HTMLInputElement>('#mzj-bg-video');
    wireFilePickerLabel(imageInput, this.query('#mzj-bg-image-name'), 'لم يتم اختيار صورة');
    wireFilePickerLabel(videoInput, this.query('#mzj-bg-video-name'), 'لم يتم اختيار فيديو');

    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (file) void this.deps.background.setImage(file).then(() => this.uploadHint.show('image'));
    });

    videoInput.addEventListener('change', () => {
      const file = videoInput.files?.[0];
      if (file) void this.deps.background.setVideo(file).then(() => this.uploadHint.show('video'));
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

  /** Current value of the greeting field, for the opening phrase-reveal — falls back to "مبروك" when left empty. */
  getGreetingText(): string {
    const textInput = this.query<HTMLInputElement>('#mzj-greeting-text');
    return textInput.value.trim() || 'مبروك';
  }
}
