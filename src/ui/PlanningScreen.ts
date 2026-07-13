import type { Application } from 'pixi.js';
import { type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import { icon } from './icons';
import { UploadHint } from './UploadHint';
import { TextComposer, type TextRevealConfig } from './TextComposer';
import { ColorPickerPanel } from './ColorPickerPanel';
import { ShapesPanel } from './ShapesPanel';

export type LaunchMode = 'mass' | 'sequential';

/** Where a launch actually originates from: exactly where tapped ("حر"), or snapped to the nearest mortar tube ("مدفع") — see the "مدفع" entry in ShapesPanel. */
export type InputMode = 'tap' | 'mortar';

export interface PlanningScreenDeps {
  app: Application;
  fireworks: FireworksSystem;
  background: BackgroundLayer;
  /** Lets PlanningMode arm/disarm itself in sync — active only during 'sequential'. */
  onModeChange: (mode: LaunchMode) => void;
  /** "تسجيل فيديو": starts/stops recording the show's output (distinct from "فيديو خلفية حي" right above it, which picks the *input* background media, not the output). */
  onToggleRecording: () => void;
  /** "لقطة": captures a single high-resolution still of the current frame. */
  onSnapshot: () => void;
  /** "مدفع" (inside ShapesPanel now, moved from the header): fires with the new mode every time the player toggles it. */
  onInputModeChange: (mode: InputMode) => void;
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
 * Full-screen planning layout — a permanent part of the fireworks mood, not
 * something opened via any trigger: it reveals itself the instant this
 * class is constructed (see `show()` called at the end of the constructor)
 * and only disappears once "ابدأ العرض" actually fires the show (see
 * `hide()`, called from `beginShow()` in fireworksMood.ts). There is no
 * "خطة إطلاق" gate icon anywhere, and no duplicate mode icons in the
 * header — "إطلاق جماعي"/"إطلاق متتابع" only exist here, in this screen.
 *
 * Neither mode icon is a "fire" button — they only set what a subsequent
 * shape-icon tap *means*:
 *   - 'mass': tapping a shape toggles its membership in a set that will all
 *     launch together, superimposed at one shared point, with no location
 *     step at all.
 *   - 'sequential': tapping a shape makes it "the shape currently being
 *     placed" — every following tap on the (still mostly empty) middle area
 *     drops a numbered marker of that shape there; tapping a different
 *     shape icon switches what gets placed next; a 500ms press-and-hold on
 *     an existing marker removes it (see PlanningMode).
 * There is no separate launch/confirm button anywhere in here — "ابدأ
 * العرض" is the single trigger for both firing whichever plan is active and
 * collapsing into full immersion; see `beginShow()` in fireworksMood.ts.
 *
 * Every other icon that has a real, already-built function behind it
 * (random/ground-fountain mode, auto-show, background image/video,
 * dimmer/glow, lab sliders) is wired here directly to FireworksSystem /
 * BackgroundLayer. There is deliberately no standalone "البيئة" icon
 * anymore: each control it used to group behind one tap now has its own
 * dedicated icon instead.
 *
 * "الأشكال" opens ShapesPanel — a fully canvas-drawn (no HTML/CSS) panel
 * docked beside this same right icon column, same style/geometry as
 * ColorPickerPanel (see SideDockPanel) — holding all 7 shape/pattern icons
 * (peony, rose, kamuro, ground fountain, palm crossette, multi-ring,
 * strobe), consolidated here instead of spread across both side columns.
 * Each keeps its exact original behavior (shape toggle or ground-fountain
 * mode toggle) via the callbacks passed into ShapesPanel; tapping any of
 * them also closes it immediately, same auto-hide as ColorPicker. "نص" (T)
 * opens the full text-composing flow — see TextComposer.
 */
export class PlanningScreen {
  readonly root: HTMLDivElement;
  private readonly deps: PlanningScreenDeps;
  private readonly uploadHint: UploadHint;
  private readonly textComposer: TextComposer;
  private readonly colorPicker: ColorPickerPanel;
  private readonly shapesPanel: ShapesPanel;
  private mode: LaunchMode = 'mass';
  private readonly massSelection = new Set<BurstType>();
  private activeSequentialShape: BurstType | null = null;
  private groundFountainEnabled = false;
  private mortarModeEnabled = false;
  private liveDocumentationArmed = false;
  private hintTimer: number | undefined;

  constructor(deps: PlanningScreenDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-planning-screen';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.uploadHint = new UploadHint(this.root);
    // Canvas-drawn (no HTML/CSS) glowing swatch panel — see ColorPickerPanel.
    // It docks just left of the right icon column's live on-screen edge, so
    // it never overlaps/covers those icons.
    const getLeftBoundary = () => this.query<HTMLElement>('.mzj-planning-side-right').getBoundingClientRect().left;
    this.colorPicker = new ColorPickerPanel(
      deps.app,
      deps.fireworks,
      getLeftBoundary,
      // Keeps the trigger icon's active state true even when the panel
      // closes itself (a confirmed swatch pick), not just via the trigger.
      (open) => this.query<HTMLButtonElement>('#mzj-planning-open-color').classList.toggle('active', open),
    );
    this.shapesPanel = new ShapesPanel(
      deps.app,
      getLeftBoundary,
      (open) => this.query<HTMLButtonElement>('#mzj-planning-open-shapes').classList.toggle('active', open),
      (type) => this.handlePickShape(type),
      () => this.handleToggleGroundFountain(),
      () => this.handleToggleMortarMode(),
    );

    // While composing text (input+effects bar, or the position/scale
    // control box), this screen's own icon columns step aside so the
    // composer stays the sole focus — restored once the text is committed.
    this.textComposer = new TextComposer({
      app: deps.app,
      onComposingChange: (composing) => this.root.classList.toggle('mzj-planning-composing', composing),
    });

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.root.querySelector('#mzj-planning-mode-mass')!.addEventListener('click', () => this.setMode('mass'));
    this.root
      .querySelector('#mzj-planning-mode-sequential')!
      .addEventListener('click', () => this.setMode('sequential'));
    this.root.querySelector('#mzj-planning-open-text')!.addEventListener('click', () => this.textComposer.open());

    this.wireRandomMode();
    this.wireAutoShow();
    this.wireSubpanels();
    this.wireMedia();
    this.wireRecording();
    this.wireSnapshot();
    this.wireSliders();
    this.wireColorPicker();
    this.wireShapesTrigger();

    // The whole screen is a permanent part of the fireworks mood now — no
    // "open" trigger anywhere reveals it, it's just visible the instant the
    // mood boots (see the class doc-comment). hide() still collapses it once
    // "ابدأ العرض" actually fires the show.
    this.show(this.mode);
  }

  /** Called by fireworksMood.ts once a recording actually starts/stops, to sync the icon. */
  setRecordingState(isRecording: boolean): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-record');
    button.classList.toggle('mzj-recording', isRecording);
    button.innerHTML = `${icon(isRecording ? 'squareStop' : 'recordDot', 22)}<span>${isRecording ? 'إيقاف التسجيل' : 'تسجيل فيديو'}</span>`;
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
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    for (const el of this.root.querySelectorAll('.mzj-planning-subpanel.open')) el.classList.remove('open');
    // The camera trigger's `.active` means "a video background is set", not
    // "its panel is open" — it must survive closing/reopening the screen,
    // so it's excluded from this generic reset (see wireSubpanels).
    for (const el of this.root.querySelectorAll('[id^="mzj-planning-open-"].active:not(#mzj-planning-open-camera)')) {
      el.classList.remove('active');
    }
  }

  /** What "ابدأ العرض" should fire, per the currently active mode — see fireworksMood.ts's beginShow(). */
  getMode(): LaunchMode {
    return this.mode;
  }

  /** The shapes selected for a 'mass' launch (empty if none, or if the active mode is 'sequential'). */
  getMassSelection(): BurstType[] {
    return Array.from(this.massSelection);
  }

  /** True once "توثيق مباشر" was chosen from the camera icon's picker — tells beginShow() to auto record/stop. */
  isLiveDocumentationArmed(): boolean {
    return this.liveDocumentationArmed;
  }

  /** The greeting to reveal at "ابدأ العرض" — null if the player never touched the T icon at all this session, in which case the caller should fall back to its own default. */
  consumeTextRevealConfig(): TextRevealConfig | null {
    return this.textComposer.consumeForReveal();
  }

  /** Lets the player switch plans — the screen itself is always visible, so this is the only way mode ever changes. */
  private setMode(mode: LaunchMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.root.querySelector('#mzj-planning-mode-mass')!.classList.toggle('active', mode === 'mass');
    this.root.querySelector('#mzj-planning-mode-sequential')!.classList.toggle('active', mode === 'sequential');
    this.shapesPanel.setActive(this.computeActiveShapeIds());
    this.deps.onModeChange(mode);
  }

  private query<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  /**
   * A shape pick from ShapesPanel means something different per mode: in
   * 'mass' it toggles that shape's membership in the launch-together set;
   * in 'sequential' it selects the one shape new markers get stamped with
   * (see PlanningMode.getActiveShape). Neither ever fires anything itself.
   */
  private handlePickShape(type: BurstType): void {
    if (this.mode === 'mass') {
      if (this.massSelection.has(type)) this.massSelection.delete(type);
      else this.massSelection.add(type);
    } else {
      this.activeSequentialShape = type;
    }
    this.shapesPanel.setActive(this.computeActiveShapeIds());
  }

  private handleToggleGroundFountain(): void {
    this.groundFountainEnabled = !this.groundFountainEnabled;
    this.deps.fireworks.setGroundFountainMode(this.groundFountainEnabled);
    this.shapesPanel.setActive(this.computeActiveShapeIds());
  }

  /** "مدفع": also snaps sequential pin placement to the nearest mortar tube (see PlanningMode's resolveX dep in fireworksMood.ts), not just ordinary free-tap firing. */
  private handleToggleMortarMode(): void {
    this.mortarModeEnabled = !this.mortarModeEnabled;
    this.deps.onInputModeChange(this.mortarModeEnabled ? 'mortar' : 'tap');
    this.shapesPanel.setActive(this.computeActiveShapeIds());
  }

  /** Ground fountain and مدفع are independent on/off toggles (not tied to mode), so they're always unioned in on top of whichever shape(s) the current mode has active. */
  private computeActiveShapeIds(): Set<string> {
    const ids: Set<string> =
      this.mode === 'mass'
        ? new Set(this.massSelection)
        : new Set(this.activeSequentialShape ? [this.activeSequentialShape] : []);
    if (this.groundFountainEnabled) ids.add('groundFountain');
    if (this.mortarModeEnabled) ids.add('mortar');
    return ids;
  }

  /** getActiveShape dep PlanningMode calls on every stage tap while sequential mode is active. */
  getActiveSequentialShape(): BurstType | null {
    return this.activeSequentialShape;
  }

  /**
   * "لون المقذوفة" and "الأشكال": both triggers stay normal HTML icon
   * buttons (same as every other icon in this column), but each opens a
   * fully canvas-drawn SideDockPanel, not an HTML subpanel — so each has to
   * close every HTML subpanel *and* the other canvas panel itself (they'd
   * otherwise stay open underneath it), and wireSubpanels closes both
   * whenever an HTML subpanel opens.
   */
  private wireColorPicker(): void {
    const trigger = this.query<HTMLButtonElement>('#mzj-planning-open-color');
    trigger.addEventListener('click', () => {
      const willOpen = !this.colorPicker.open;
      this.closeAllHtmlSubpanels();
      this.shapesPanel.setOpen(false);
      this.colorPicker.setOpen(willOpen);
    });
  }

  private wireShapesTrigger(): void {
    const trigger = this.query<HTMLButtonElement>('#mzj-planning-open-shapes');
    trigger.addEventListener('click', () => {
      const willOpen = !this.shapesPanel.open;
      this.closeAllHtmlSubpanels();
      this.colorPicker.setOpen(false);
      this.shapesPanel.setOpen(willOpen);
    });
  }

  private closeAllHtmlSubpanels(): void {
    for (const el of this.root.querySelectorAll('.mzj-planning-subpanel.open')) el.classList.remove('open');
    for (const el of this.root.querySelectorAll(
      '[id^="mzj-planning-open-"].active:not(#mzj-planning-open-camera):not(#mzj-planning-open-color):not(#mzj-planning-open-shapes)',
    )) {
      el.classList.remove('active');
    }
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

  private wireAutoShow(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-auto-show');
    let enabled = false;
    button.addEventListener('click', () => {
      enabled = !enabled;
      this.deps.fireworks.setAutoLaunch(enabled);
      button.classList.toggle('active', enabled);
    });
  }

  /**
   * All subpanels/pickers share the same on-screen spot, so opening one must
   * close the rest. The camera trigger's own `.active` class is deliberately
   * left alone here — for it, "active" means "a video background is
   * currently set" (see wireMedia), not "this panel happens to be open".
   */
  private wireSubpanels(): void {
    const cameraTrigger = this.query<HTMLButtonElement>('#mzj-planning-open-camera');
    const entries = [
      { trigger: cameraTrigger, panel: this.query<HTMLDivElement>('#mzj-planning-camera-panel') },
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-dimmer'), panel: this.query<HTMLDivElement>('#mzj-planning-dimmer-panel') },
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-glow'), panel: this.query<HTMLDivElement>('#mzj-planning-glow-panel') },
      { trigger: this.query<HTMLButtonElement>('#mzj-planning-open-lab'), panel: this.query<HTMLDivElement>('#mzj-planning-lab-panel') },
    ];

    for (const entry of entries) {
      entry.trigger.addEventListener('click', () => {
        const willOpen = !entry.panel.classList.contains('open');
        this.colorPicker.setOpen(false);
        this.shapesPanel.setOpen(false);
        for (const other of entries) {
          other.panel.classList.toggle('open', other === entry && willOpen);
          if (other.trigger !== cameraTrigger) other.trigger.classList.toggle('active', other === entry && willOpen);
        }
      });
    }
  }

  private closeCameraPanel(): void {
    this.query<HTMLDivElement>('#mzj-planning-camera-panel').classList.remove('open');
  }

  /**
   * The camera icon is the single entry point for both background-video
   * paths: tapping it opens a small picker with "رفع فيديو" (existing file
   * upload) and "توثيق مباشر" (new — live device camera as the backdrop,
   * armed here so beginShow() auto-starts/stops recording around it).
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

    const cameraButton = this.query<HTMLButtonElement>('#mzj-planning-open-camera');
    const videoInput = this.query<HTMLInputElement>('#mzj-bg-video');

    this.query<HTMLButtonElement>('#mzj-planning-camera-upload').addEventListener('click', () => {
      this.closeCameraPanel();
      videoInput.click();
    });
    videoInput.addEventListener('change', () => {
      const file = videoInput.files?.[0];
      if (!file) return;
      void this.deps.background.setVideo(file).then(() => {
        this.liveDocumentationArmed = false;
        this.uploadHint.show('video');
        cameraButton.classList.add('active');
      });
    });

    this.query<HTMLButtonElement>('#mzj-planning-camera-live').addEventListener('click', () => {
      this.closeCameraPanel();
      void this.deps.background
        .setLiveCamera()
        .then(() => {
          this.liveDocumentationArmed = true;
          cameraButton.classList.add('active');
        })
        .catch((error) => {
          console.error('تعذّر تشغيل الكاميرا الحية (تحقّق من إذن الوصول للكاميرا):', error);
        });
    });
  }

  /**
   * "تسجيل فيديو": starts/stops recording the show's actual output (a
   * distinct concern from "فيديو خلفية حي" right above it, which only picks
   * the *input* background media) — stays usable at any time, including
   * mid-show and during plain free-tap play with no plan ever set up.
   */
  private wireRecording(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-record');
    const canRecord = typeof MediaRecorder !== 'undefined' && typeof this.deps.app.canvas.captureStream === 'function';
    if (!canRecord) {
      button.disabled = true;
      button.title = 'تسجيل الفيديو غير مدعوم في هذا المتصفح';
      return;
    }
    button.addEventListener('click', () => this.deps.onToggleRecording());
  }

  private wireSnapshot(): void {
    const button = this.query<HTMLButtonElement>('#mzj-planning-snapshot');
    button.addEventListener('click', () => this.deps.onSnapshot());
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
        <button type="button" id="mzj-planning-open-dimmer" class="mzj-planning-icon-btn">${icon('palette', 22)}<span>إضاءة الخلفية</span></button>
        <button type="button" id="mzj-planning-auto-show" class="mzj-planning-icon-btn">${icon('sparkles', 22)}<span>العرض التلقائي</span></button>
        <button type="button" id="mzj-planning-open-lab" class="mzj-planning-icon-btn">${icon('sliders', 22)}<span>المختبر</span></button>
        <button type="button" id="mzj-planning-open-text" class="mzj-planning-icon-btn">
          <span class="mzj-planning-text-icon">T</span><span>نص</span>
        </button>
        <button type="button" id="mzj-planning-random-mode" class="mzj-planning-icon-btn">${icon('shuffle', 22)}<span>توليد عشوائي هجين</span></button>
        <button type="button" id="mzj-planning-mode-mass" class="mzj-planning-icon-btn">${icon('fireworksMood', 22)}<span>إطلاق جماعي</span></button>
        <button type="button" id="mzj-planning-mode-sequential" class="mzj-planning-icon-btn">${icon('mapPin', 22)}<span>إطلاق متتابع</span></button>
        <button type="button" id="mzj-planning-open-shapes" class="mzj-planning-icon-btn">${icon('shapes', 22)}<span>الأشكال</span></button>
        <button type="button" id="mzj-planning-open-camera" class="mzj-planning-icon-btn">${icon('camera', 22)}<span>فيديو خلفية حي</span></button>
        <button type="button" id="mzj-planning-record" class="mzj-planning-icon-btn">${icon('recordDot', 22)}<span>تسجيل فيديو</span></button>
        <button type="button" id="mzj-planning-snapshot" class="mzj-planning-icon-btn">${icon('camera', 22)}<span>لقطة</span></button>
        <button type="button" id="mzj-planning-bg-image" class="mzj-planning-icon-btn">${icon('image', 22)}<span>صورة خلفية</span></button>
        <button type="button" id="mzj-planning-open-glow" class="mzj-planning-icon-btn">${icon('gem', 22)}<span>توهج الألعاب النارية</span></button>
        <button type="button" id="mzj-planning-open-color" class="mzj-planning-icon-btn">${icon('droplet', 22)}<span>لون المقذوفة</span></button>
      </div>

      <input type="file" id="mzj-bg-image" accept="image/*" class="mzj-file-input-sr" />
      <input type="file" id="mzj-bg-video" accept="video/*" class="mzj-file-input-sr" />

      <div class="mzj-planning-subpanel mzj-planning-camera-panel" id="mzj-planning-camera-panel">
        <button type="button" id="mzj-planning-camera-upload" class="mzj-planning-choice-btn">رفع فيديو</button>
        <button type="button" id="mzj-planning-camera-live" class="mzj-planning-choice-btn">توثيق مباشر</button>
      </div>

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
}
