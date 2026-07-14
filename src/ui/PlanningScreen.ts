import type { Application } from 'pixi.js';
import { type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import { UploadHint } from './UploadHint';
import { TextComposer, type TextRevealConfig } from './TextComposer';
import { ColorPickerPanel } from './ColorPickerPanel';
import { ShapesPanel } from './ShapesPanel';
import { PlanningIconColumn, type IconRowSpec } from './PlanningIconColumn';

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
  private readonly iconColumn: PlanningIconColumn;
  private readonly colorPicker: ColorPickerPanel;
  private readonly shapesPanel: ShapesPanel;
  private mode: LaunchMode = 'mass';
  private readonly massSelection = new Set<BurstType>();
  private activeSequentialShape: BurstType | null = null;
  private groundFountainEnabled = false;
  private mortarModeEnabled = false;
  private liveDocumentationArmed = false;
  private randomModeEnabled = false;
  private autoShowEnabled = false;
  private hintTimer: number | undefined;

  private static readonly SUBPANELS = {
    camera: { triggerId: 'mzj-planning-open-camera', panelId: 'mzj-planning-camera-panel' },
    dimmer: { triggerId: 'mzj-planning-open-dimmer', panelId: 'mzj-planning-dimmer-panel' },
    glow: { triggerId: 'mzj-planning-open-glow', panelId: 'mzj-planning-glow-panel' },
    lab: { triggerId: 'mzj-planning-open-lab', panelId: 'mzj-planning-lab-panel' },
  } as const;

  constructor(deps: PlanningScreenDeps) {
    this.deps = deps;

    this.root = document.createElement('div');
    this.root.id = 'mzj-planning-screen';
    this.root.className = 'mzj-hidden';
    this.root.innerHTML = this.template();
    document.body.appendChild(this.root);
    this.uploadHint = new UploadHint(this.root);

    // The right icon column itself is genuine Pixi (see PlanningIconColumn)
    // — must exist before ColorPickerPanel/ShapesPanel below, since their
    // own constructors call `getLeftBoundary` synchronously while docking.
    this.iconColumn = new PlanningIconColumn(deps.app, this.buildIconRowSpecs());

    // Canvas-drawn (no HTML/CSS) glowing swatch panel — see ColorPickerPanel.
    // It docks just left of the right icon column's live on-screen edge, so
    // it never overlaps/covers those icons.
    const getLeftBoundary = () => this.iconColumn.getLeftEdgeX();
    this.colorPicker = new ColorPickerPanel(
      deps.app,
      deps.fireworks,
      getLeftBoundary,
      // Keeps the trigger icon's active state true even when the panel
      // closes itself (a confirmed swatch pick), not just via the trigger.
      (open) => this.iconColumn.setActive('mzj-planning-open-color', open),
    );
    this.shapesPanel = new ShapesPanel(
      deps.app,
      getLeftBoundary,
      (open) => this.iconColumn.setActive('mzj-planning-open-shapes', open),
      (type) => this.handlePickShape(type),
      () => this.handleToggleGroundFountain(),
      () => this.handleToggleMortarMode(),
    );

    // While composing text (input+effects bar, or the position/scale
    // control box), this screen's own icon column steps aside so the
    // composer stays the sole focus — restored once the text is committed.
    this.textComposer = new TextComposer({
      app: deps.app,
      onComposingChange: (composing) => {
        this.root.classList.toggle('mzj-planning-composing', composing);
        this.iconColumn.container.visible = !composing;
      },
    });

    for (const type of ['pointerdown', 'click', 'input', 'change'] as const) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.wireMedia();
    this.wireRecording();
    this.wireSliders();

    // The whole screen is a permanent part of the fireworks mood now — no
    // "open" trigger anywhere reveals it, it's just visible the instant the
    // mood boots (see the class doc-comment). hide() still collapses it once
    // "ابدأ العرض" actually fires the show.
    this.show(this.mode);
  }

  /**
   * Every row's behavior, ported 1:1 from the old DOM buttons' `click`
   * listeners — see PlanningIconColumn for how these actually render/hit-
   * test. Subpanel triggers (camera/dimmer/glow/lab) still open the
   * existing HTML subpanels for now (next pass in PROGRESS.md); the shapes/
   * color triggers already open fully-Pixi SideDockPanels.
   */
  private buildIconRowSpecs(): IconRowSpec[] {
    return [
      { id: 'mzj-planning-open-dimmer', icon: 'palette', label: 'إضاءة الخلفية', onTap: () => this.toggleSubpanel('dimmer') },
      { id: 'mzj-planning-auto-show', icon: 'sparkles', label: 'العرض التلقائي', onTap: () => this.toggleAutoShow() },
      { id: 'mzj-planning-open-lab', icon: 'sliders', label: 'المختبر', onTap: () => this.toggleSubpanel('lab') },
      { id: 'mzj-planning-open-text', icon: 'T', label: 'نص', onTap: () => this.textComposer.open() },
      { id: 'mzj-planning-random-mode', icon: 'shuffle', label: 'توليد عشوائي هجين', onTap: () => this.toggleRandomMode() },
      { id: 'mzj-planning-mode-mass', icon: 'fireworksMood', label: 'إطلاق جماعي', onTap: () => this.setMode('mass') },
      { id: 'mzj-planning-mode-sequential', icon: 'mapPin', label: 'إطلاق متتابع', onTap: () => this.setMode('sequential') },
      { id: 'mzj-planning-open-shapes', icon: 'shapes', label: 'الأشكال', onTap: () => this.toggleShapesPanel() },
      { id: 'mzj-planning-open-camera', icon: 'camera', label: 'فيديو خلفية حي', onTap: () => this.toggleSubpanel('camera') },
      { id: 'mzj-planning-record', icon: 'recordDot', label: 'تسجيل فيديو', onTap: () => this.deps.onToggleRecording() },
      { id: 'mzj-planning-snapshot', icon: 'camera', label: 'لقطة', onTap: () => this.deps.onSnapshot() },
      {
        id: 'mzj-planning-bg-image',
        icon: 'image',
        label: 'صورة خلفية',
        // The one and only trigger for the native OS file picker — see
        // PROGRESS.md's "hard constraints" section for why `#mzj-bg-image`
        // must stay a real (if invisible) DOM `<input type="file">`.
        onTap: () => this.query<HTMLInputElement>('#mzj-bg-image').click(),
      },
      { id: 'mzj-planning-open-glow', icon: 'gem', label: 'توهج الألعاب النارية', onTap: () => this.toggleSubpanel('glow') },
      { id: 'mzj-planning-open-color', icon: 'droplet', label: 'لون المقذوفة', onTap: () => this.toggleColorPicker() },
    ];
  }

  /** Called by fireworksMood.ts once a recording actually starts/stops, to sync the icon. */
  setRecordingState(isRecording: boolean): void {
    this.iconColumn.setRecording(isRecording);
  }

  show(mode: LaunchMode): void {
    this.setMode(mode);
    this.root.classList.remove('mzj-hidden');
    this.iconColumn.container.visible = true;

    const hint = this.root.querySelector<HTMLDivElement>('#mzj-planning-hint')!;
    hint.classList.remove('mzj-planning-hint-hidden');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => hint.classList.add('mzj-planning-hint-hidden'), HINT_VISIBLE_MS);
  }

  hide(): void {
    this.root.classList.add('mzj-hidden');
    this.iconColumn.container.visible = false;
    window.clearTimeout(this.hintTimer);
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    for (const el of this.root.querySelectorAll('.mzj-planning-subpanel.open')) el.classList.remove('open');
    // The camera trigger's `active` means "a video background is set", not
    // "its panel is open" — it must survive closing/reopening the screen,
    // so it's excluded from this generic reset (see toggleSubpanel).
    for (const entry of Object.values(PlanningScreen.SUBPANELS)) {
      if (entry.triggerId !== PlanningScreen.SUBPANELS.camera.triggerId) this.iconColumn.setActive(entry.triggerId, false);
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
    this.iconColumn.setActive('mzj-planning-mode-mass', mode === 'mass');
    this.iconColumn.setActive('mzj-planning-mode-sequential', mode === 'sequential');
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
   * "لون المقذوفة" and "الأشكال": both triggers are rows in the (now fully
   * Pixi) icon column, but each opens a fully canvas-drawn SideDockPanel,
   * not an HTML subpanel — so each has to close every HTML subpanel *and*
   * the other canvas panel itself (they'd otherwise stay open underneath
   * it), and toggleSubpanel() closes both whenever an HTML subpanel opens.
   */
  private toggleColorPicker(): void {
    const willOpen = !this.colorPicker.open;
    this.closeAllHtmlSubpanels();
    this.shapesPanel.setOpen(false);
    this.colorPicker.setOpen(willOpen);
  }

  private toggleShapesPanel(): void {
    const willOpen = !this.shapesPanel.open;
    this.closeAllHtmlSubpanels();
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(willOpen);
  }

  private closeAllHtmlSubpanels(): void {
    for (const el of this.root.querySelectorAll('.mzj-planning-subpanel.open')) el.classList.remove('open');
    for (const entry of Object.values(PlanningScreen.SUBPANELS)) {
      if (entry.triggerId !== PlanningScreen.SUBPANELS.camera.triggerId) this.iconColumn.setActive(entry.triggerId, false);
    }
  }

  private toggleRandomMode(): void {
    const enabled = !this.randomModeEnabled;
    this.randomModeEnabled = enabled;
    this.deps.fireworks.setRandomMode(enabled);
    this.iconColumn.setActive('mzj-planning-random-mode', enabled);
  }

  private toggleAutoShow(): void {
    const enabled = !this.autoShowEnabled;
    this.autoShowEnabled = enabled;
    this.deps.fireworks.setAutoLaunch(enabled);
    this.iconColumn.setActive('mzj-planning-auto-show', enabled);
  }

  /**
   * All subpanels/pickers share the same on-screen spot, so opening one must
   * close the rest. The camera trigger's own active state is deliberately
   * left alone here — for it, "active" means "a video background is
   * currently set" (see wireMedia), not "this panel happens to be open".
   */
  private toggleSubpanel(kind: keyof typeof PlanningScreen.SUBPANELS): void {
    const entries = Object.entries(PlanningScreen.SUBPANELS) as [
      keyof typeof PlanningScreen.SUBPANELS,
      { triggerId: string; panelId: string },
    ][];
    const target = PlanningScreen.SUBPANELS[kind];
    const willOpen = !this.query<HTMLDivElement>(`#${target.panelId}`).classList.contains('open');
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    for (const [otherKind, entry] of entries) {
      const isTarget = otherKind === kind;
      this.query<HTMLDivElement>(`#${entry.panelId}`).classList.toggle('open', isTarget && willOpen);
      if (otherKind !== 'camera') this.iconColumn.setActive(entry.triggerId, isTarget && willOpen);
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
    // "صورة خلفية"'s own tap (opening the native file picker) is wired
    // directly on its icon-column row — see buildIconRowSpecs().
    const imageInput = this.query<HTMLInputElement>('#mzj-bg-image');
    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      void this.deps.background.setImage(file).then(() => {
        this.uploadHint.show('image');
        this.iconColumn.setActive('mzj-planning-bg-image', true);
      });
    });

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
        this.iconColumn.setActive('mzj-planning-open-camera', true);
      });
    });

    this.query<HTMLButtonElement>('#mzj-planning-camera-live').addEventListener('click', () => {
      this.closeCameraPanel();
      void this.deps.background
        .setLiveCamera()
        .then(() => {
          this.liveDocumentationArmed = true;
          this.iconColumn.setActive('mzj-planning-open-camera', true);
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
  /** "تسجيل فيديو"'s own tap is wired directly on its icon-column row (see buildIconRowSpecs()) — this only handles the unsupported-browser case. */
  private wireRecording(): void {
    const canRecord = typeof MediaRecorder !== 'undefined' && typeof this.deps.app.canvas.captureStream === 'function';
    if (!canRecord) this.iconColumn.setDisabled('mzj-planning-record', true);
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
