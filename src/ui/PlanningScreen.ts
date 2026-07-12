import { ALL_BURST_TYPES, type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import { icon } from './icons';
import { UploadHint } from './UploadHint';

export type LaunchMode = 'mass' | 'sequential';

export interface PlanningScreenDeps {
  fireworks: FireworksSystem;
  background: BackgroundLayer;
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

const HINT_VISIBLE_MS = 2600;

/**
 * Full-screen planning layout shown after the player picks "إطلاق جماعي" or
 * "إطلاق متتابع". Every icon that has a real, already-built function behind
 * it (shape toggles, random/ground-fountain mode, auto-show, background
 * image/video, dimmer/glow, lab sliders) is wired here directly to
 * FireworksSystem / BackgroundLayer — this is now the only place that
 * functionality lives. There is deliberately no standalone "البيئة" icon
 * anymore: each control it used to group behind one tap now has its own
 * dedicated icon instead.
 *
 * Two icons remain deliberately inert (see `.mzj-planning-icon-btn-disabled`
 * in the template): "الأنماط" has no distinct destination left now that the
 * patterns-tab content it used to reveal is already individually represented
 * elsewhere on this screen, and "نص" (T) is the still-unbuilt text-entry
 * placeholder. The empty middle area is reserved for the future tap-to-place
 * interaction (Group 3) and stays untouched by anything built here.
 */
export class PlanningScreen {
  readonly root: HTMLDivElement;
  private readonly deps: PlanningScreenDeps;
  private readonly uploadHint: UploadHint;
  private readonly enabledBurstTypes = new Set<BurstType>(ALL_BURST_TYPES);
  private hintTimer: number | undefined;

  constructor(deps: PlanningScreenDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-planning-screen';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.uploadHint = new UploadHint(this.root);

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.root.querySelector('#mzj-planning-mode-mass')!.addEventListener('click', () => this.setMode('mass'));
    this.root
      .querySelector('#mzj-planning-mode-sequential')!
      .addEventListener('click', () => this.setMode('sequential'));

    this.wireShapeToggles();
    this.wireRandomMode();
    this.wireGroundFountainMode();
    this.wireAutoShow();
    this.wireSubpanels();
    this.wireMedia();
    this.wireSliders();
  }

  show(mode: LaunchMode): void {
    this.setMode(mode);
    this.root.classList.remove('mzj-hidden');

    const hint = this.root.querySelector<HTMLDivElement>('#mzj-planning-hint')!;
    hint.classList.remove('mzj-planning-hint-hidden');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => hint.classList.add('mzj-planning-hint-hidden'), HINT_VISIBLE_MS);
  }

  hide(): void {
    this.root.classList.add('mzj-hidden');
    window.clearTimeout(this.hintTimer);
    for (const el of this.root.querySelectorAll('.mzj-planning-subpanel.open, [id^="mzj-planning-open-"].active')) {
      el.classList.remove('open', 'active');
    }
  }

  /** Lets the player switch modes without leaving the planning screen. */
  private setMode(mode: LaunchMode): void {
    this.root.dataset.mode = mode;
    this.root.querySelector('#mzj-planning-mode-mass')!.classList.toggle('active', mode === 'mass');
    this.root.querySelector('#mzj-planning-mode-sequential')!.classList.toggle('active', mode === 'sequential');
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  /** Each shape icon enables/disables that burst type for random/tap-fired shows — the same toggle BottomDashboard's old per-shape buttons drove. */
  private wireShapeToggles(): void {
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-burst-type]'));

    const sync = () => {
      for (const btn of buttons) {
        const type = btn.dataset.burstType as BurstType;
        btn.classList.toggle('active', this.enabledBurstTypes.has(type));
      }
      this.deps.fireworks.setEnabledTypes(Array.from(this.enabledBurstTypes));
    };

    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const type = btn.dataset.burstType as BurstType;
        if (this.enabledBurstTypes.has(type)) {
          // Always keep at least one shape selectable.
          if (this.enabledBurstTypes.size > 1) this.enabledBurstTypes.delete(type);
        } else {
          this.enabledBurstTypes.add(type);
        }
        sync();
      });
    }

    sync();
  }

  private wireRandomMode(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-random-mode');
    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setRandomMode(enabled);
      button.classList.toggle('active', enabled);
    });
  }

  private wireGroundFountainMode(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-ground-fountain');
    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setGroundFountainMode(enabled);
      button.classList.toggle('active', enabled);
    });
  }

  private wireAutoShow(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-auto-show');
    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setAutoLaunch(enabled);
      button.classList.toggle('active', enabled);
    });
  }

  /** All subpanels/pickers share the same on-screen spot, so opening one must close the rest. */
  private wireSubpanels(): void {
    const entries = [
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-dimmer'), panel: this.query<HTMLDivElement>('#mzj-planning-dimmer-panel') },
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-glow'), panel: this.query<HTMLDivElement>('#mzj-planning-glow-panel') },
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-lab'), panel: this.query<HTMLDivElement>('#mzj-planning-lab-panel') },
    ];

    for (const entry of entries) {
      entry.trigger.addEventListener('click', () => {
        const willOpen = !entry.panel.classList.contains('open');
        for (const other of entries) {
          other.panel.classList.toggle('open', other === entry && willOpen);
          other.trigger.classList.toggle('active', other === entry && willOpen);
        }
      });
    }
  }

  /**
   * Image and live-video backgrounds each get their own icon that opens the
   * native file picker directly (no intermediate row/label) — توثيق is now
   * the live-video trigger, not a snapshot (the header has its own
   * independent snapshot button already).
   */
  private wireMedia(): void {
    const imageButton = this.query<HTMLButtonElement>('#mzj-planning-bg-image');
    const imageInput = this.query<HTMLInputElement>('#mzj-bg-image');
    imageButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      void this.deps.background.setImage(file).then(() => {
        this.uploadHint.show('image');
        imageButton.classList.add('active');
      });
    });

    const videoButton = this.query<HTMLButtonElement>('#mzj-planning-camera');
    const videoInput = this.query<HTMLInputElement>('#mzj-bg-video');
    videoButton.addEventListener('click', () => videoInput.click());
    videoInput.addEventListener('change', () => {
      const file = videoInput.files?.[0];
      if (!file) return;
      void this.deps.background.setVideo(file).then(() => {
        this.uploadHint.show('video');
        videoButton.classList.add('active');
      });
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

  private sliderRow(spec: SliderSpec): string {
    return `
      <div class="mcp-slider-row">
        <label for="${spec.id}">${spec.label}</label>
        <input type="range" id="${spec.id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" />
        <output id="${spec.id}-out" for="${spec.id}">${spec.value}</output>
      </div>
    `;
  }

  private template(): string {
    return `
      <div class="mzj-planning-hint" id="mzj-planning-hint">اختر الشكل وحدد موقعه</div>
      <div class="mzj-planning-side mzj-planning-side-right">
        <button type="button" id="mzj-planning-mode-mass" class="mzj-planning-icon-btn">${icon('fireworksMood', 22)}<span>إطلاق جماعي</span></button>
        <button type="button" id="mzj-planning-mode-sequential" class="mzj-planning-icon-btn">${icon('mapPin', 22)}<span>إطلاق متتابع</span></button>
        ${this.shapeIconButton('peony', 'بيوني بقلب')}
        ${this.shapeIconButton('rose', 'وردة')}
        ${this.shapeIconButton('kamuro', 'كامورو ذهبي')}
        <button type="button" id="mzj-planning-camera" class="mzj-planning-icon-btn">${icon('camera', 22)}<span>فيديو خلفية حي</span></button>
        <button type="button" id="mzj-planning-bg-image" class="mzj-planning-icon-btn">${icon('image', 22)}<span>صورة خلفية</span></button>
        <button type="button" class="mzj-planning-icon-btn mzj-planning-icon-btn-disabled" disabled title="لا وظيفة مستقلة بعد">${icon('shapes', 22)}<span>الأنماط</span></button>
        <button type="button" id="mzj-planning-open-glow" class="mzj-planning-icon-btn">${icon('gem', 22)}<span>توهج الألعاب النارية</span></button>
      </div>
      <div class="mzj-planning-side mzj-planning-side-left">
        <button type="button" id="mzj-planning-random-mode" class="mzj-planning-icon-btn">${icon('shuffle', 22)}<span>توليد عشوائي هجين</span></button>
        <button type="button" id="mzj-planning-ground-fountain" class="mzj-planning-icon-btn">${icon('groundFountain', 22)}<span>نافورة أرضية</span></button>
        ${this.shapeIconButton('crossette', 'كروسيت نخلة')}
        ${this.shapeIconButton('multiRing', 'حلقات متعددة')}
        ${this.shapeIconButton('strobe', 'وميض متلألئ')}
        <button type="button" id="mzj-planning-open-dimmer" class="mzj-planning-icon-btn">${icon('palette', 22)}<span>إضاءة الخلفية</span></button>
        <button type="button" id="mzj-planning-auto-show" class="mzj-planning-icon-btn">${icon('sparkles', 22)}<span>العرض التلقائي</span></button>
        <button type="button" id="mzj-planning-open-lab" class="mzj-planning-icon-btn">${icon('sliders', 22)}<span>المختبر</span></button>
        <button type="button" class="mzj-planning-icon-btn mzj-planning-icon-btn-disabled" disabled title="غير مبني بعد — دفعة مستقبلية">
          <span class="mzj-planning-text-icon">T</span><span>نص</span>
        </button>
      </div>

      <input type="file" id="mzj-bg-image" accept="image/*" class="mzj-file-input-sr" />
      <input type="file" id="mzj-bg-video" accept="video/*" class="mzj-file-input-sr" />

      <div class="mzj-planning-subpanel" id="mzj-planning-dimmer-panel">
        ${this.sliderRow(SLIDERS.dimmer)}
      </div>

      <div class="mzj-planning-subpanel" id="mzj-planning-glow-panel">
        ${this.sliderRow(SLIDERS.glow)}
      </div>

      <div class="mzj-planning-subpanel" id="mzj-planning-lab-panel">
        ${this.sliderRow(SLIDERS.density)}
        ${this.sliderRow(SLIDERS.gravity)}
        ${this.sliderRow(SLIDERS.lifespan)}
        ${this.sliderRow(SLIDERS.scale)}
      </div>
    `;
  }

  private shapeIconButton(name: BurstType, label: string): string {
    return `<button type="button" class="mzj-planning-icon-btn" data-burst-type="${name}">${icon(name, 22)}<span>${label}</span></button>`;
  }
}
