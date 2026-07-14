import { Text, TextStyle, type Application, type Container } from 'pixi.js';
import { type BurstType, type FireworksSystem } from '../fireworks/FireworksSystem';
import type { BackgroundLayer } from '../background';
import type { AudioManager } from '../audio/AudioManager';
import { UploadHint } from './UploadHint';
import { TextComposer, type TextRevealConfig } from './TextComposer';
import { ColorPickerPanel } from './ColorPickerPanel';
import { ShapesPanel } from './ShapesPanel';
import { PlanningIconColumn, type IconRowSpec } from './PlanningIconColumn';
import type { BottomSheetPanel } from './BottomSheetPanel';
import { SliderSheetPanel, CameraPickerPanel } from './PlanningSubpanels';

export type LaunchMode = 'mass' | 'sequential';

/** Where a launch actually originates from: exactly where tapped ("حر"), or snapped to the nearest mortar tube ("مدفع") — see the "مدفع" entry in ShapesPanel. */
export type InputMode = 'tap' | 'mortar';

export interface PlanningScreenDeps {
  app: Application;
  audio: AudioManager;
  /** Threaded straight through to TextComposer — its committed text is the only piece of this whole screen that counts as scene content (see fireworksMood.ts's own container-tree doc comment). Everything else this screen owns is UI chrome and gets reparented into `uiContainer`. */
  worldContainer: Container;
  uiContainer: Container;
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
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

const SLIDERS = {
  density: { label: 'كثافة الجسيمات', min: 50, max: 500, step: 1, value: 150 },
  gravity: { label: 'شدة الجاذبية', min: 0, max: 2, step: 0.05, value: 1 },
  lifespan: { label: 'عمر الجسيمات', min: 0.4, max: 2.5, step: 0.05, value: 1 },
  scale: { label: 'اتساع الانفجار', min: 0.5, max: 2, step: 0.05, value: 1 },
  glow: { label: 'توهج الألعاب النارية', min: 0, max: 10, step: 0.5, value: 2 },
  dimmer: { label: 'إضاءة الخلفية', min: 0, max: 1, step: 0.01, value: 1 },
} satisfies Record<string, SliderSpec>;

const HINT_VISIBLE_MS = 2600;
const HINT_TEXT = 'اختر الشكل وحدد موقعه';
const HINT_BOTTOM_INSET = 96;
/** Matches the old `.mzj-planning-hint { transition: opacity 0.5s ease }`. */
const HINT_FADE_MS = 500;

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
  private readonly deps: PlanningScreenDeps;
  private readonly uploadHint: UploadHint;
  private readonly textComposer: TextComposer;
  private readonly iconColumn: PlanningIconColumn;
  private readonly colorPicker: ColorPickerPanel;
  private readonly shapesPanel: ShapesPanel;
  private readonly dimmerPanel: SliderSheetPanel;
  private readonly glowPanel: SliderSheetPanel;
  private readonly labPanel: SliderSheetPanel;
  private readonly cameraPanel: CameraPickerPanel;
  private readonly hintText: Text;
  /** The two file-picker bridges — see PROGRESS.md's remaining hard constraint: only a real `<input type="file">` can raise the OS's native file/photo picker, there is no Canvas API for it. Zero stylesheet footprint (inline `style.*` only, same rigor as TextComposer's ghost keyboard bridge); unlike that bridge these stay permanently mounted (not built/destroyed per use) since they're triggered via plain `.click()` calls from Pixi row taps rather than needing to hold IME/keyboard focus. */
  private readonly bgImageInput: HTMLInputElement;
  private readonly bgVideoInput: HTMLInputElement;
  private mode: LaunchMode = 'mass';
  private readonly massSelection = new Set<BurstType>();
  private activeSequentialShape: BurstType | null = null;
  private groundFountainEnabled = false;
  private mortarModeEnabled = false;
  private liveDocumentationArmed = false;
  private randomModeEnabled = false;
  private autoShowEnabled = false;
  private hintTimer: number | undefined;
  private hintComposing = false;
  private hintAutoHidden = true;

  constructor(deps: PlanningScreenDeps) {
    this.deps = deps;

    this.bgImageInput = this.buildFileInput('image/*');
    this.bgVideoInput = this.buildFileInput('video/*');

    this.hintText = new Text({
      text: HINT_TEXT,
      style: new TextStyle({ fontFamily: 'Tajawal, system-ui, sans-serif', fontSize: 15, fontWeight: '600', fill: 0xffffff }),
    });
    this.hintText.anchor.set(0.5, 1);
    this.hintText.alpha = 0;
    this.hintText.eventMode = 'none';
    deps.uiContainer.addChild(this.hintText);
    deps.app.renderer.on('resize', () => this.layoutHint());
    this.layoutHint();

    // The right icon column itself is genuine Pixi (see PlanningIconColumn)
    // — must exist before ColorPickerPanel/ShapesPanel below, since their
    // own constructors call `getLeftBoundary` synchronously while docking.
    // Every component built in this constructor is UI chrome (never scene
    // content — see fireworksMood.ts's own container-tree doc comment), so
    // each one's top-level container is reparented into `deps.uiContainer`
    // right after construction.
    this.iconColumn = new PlanningIconColumn(deps.app, deps.audio, this.buildIconRowSpecs());
    deps.uiContainer.addChild(this.iconColumn.container);

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
    deps.uiContainer.addChild(this.colorPicker.container);
    this.shapesPanel = new ShapesPanel(
      deps.app,
      getLeftBoundary,
      (open) => this.iconColumn.setActive('mzj-planning-open-shapes', open),
      (type) => this.handlePickShape(type),
      () => this.handleToggleGroundFountain(),
      () => this.handleToggleMortarMode(),
    );
    deps.uiContainer.addChild(this.shapesPanel.container);

    // The four bottom-sheet subpanels (see PlanningSubpanels.ts /
    // BottomSheetPanel) — fully Pixi, no more `.mzj-planning-subpanel` DOM.
    this.dimmerPanel = new SliderSheetPanel(deps.app, [
      { ...SLIDERS.dimmer, onChange: (v) => deps.background.setDimmer(v) },
    ]);
    deps.uiContainer.addChild(this.dimmerPanel.container);
    this.glowPanel = new SliderSheetPanel(deps.app, [
      { ...SLIDERS.glow, onChange: (v) => deps.fireworks.updateSettings({ glow: v }) },
    ]);
    deps.uiContainer.addChild(this.glowPanel.container);
    // Needs glowPanel to already exist — see UploadHint's own doc comment.
    this.uploadHint = new UploadHint(deps.app, deps.uiContainer, this.glowPanel);
    this.labPanel = new SliderSheetPanel(deps.app, [
      { ...SLIDERS.density, onChange: (v) => deps.fireworks.updateSettings({ particleDensity: v }) },
      { ...SLIDERS.gravity, onChange: (v) => deps.fireworks.updateSettings({ gravityScale: v }) },
      { ...SLIDERS.lifespan, onChange: (v) => deps.fireworks.updateSettings({ lifespanScale: v }) },
      { ...SLIDERS.scale, onChange: (v) => deps.fireworks.updateSettings({ explosionScale: v }) },
    ]);
    deps.uiContainer.addChild(this.labPanel.container);
    this.cameraPanel = new CameraPickerPanel(
      deps.app,
      deps.audio,
      () => {
        this.cameraPanel.setOpen(false);
        this.bgVideoInput.click();
      },
      () => {
        this.cameraPanel.setOpen(false);
        void deps.background
          .setLiveCamera()
          .then(() => {
            this.liveDocumentationArmed = true;
            this.iconColumn.setActive('mzj-planning-open-camera', true);
          })
          .catch((error) => {
            console.error('تعذّر تشغيل الكاميرا الحية (تحقّق من إذن الوصول للكاميرا):', error);
          });
      },
    );
    deps.uiContainer.addChild(this.cameraPanel.container);

    // While composing text (input+effects bar, or the position/scale
    // control box), this screen's own icon column steps aside so the
    // composer stays the sole focus — restored once the text is committed.
    this.textComposer = new TextComposer({
      app: deps.app,
      audio: deps.audio,
      worldContainer: deps.worldContainer,
      uiContainer: deps.uiContainer,
      onComposingChange: (composing) => {
        this.hintComposing = composing;
        this.applyHintVisibility(false);
        this.iconColumn.container.visible = !composing;
      },
    });

    this.wireMedia();
    this.wireRecording();

    // The whole screen is a permanent part of the fireworks mood now — no
    // "open" trigger anywhere reveals it, it's just visible the instant the
    // mood boots (see the class doc-comment). hide() still collapses it once
    // "ابدأ العرض" actually fires the show.
    this.show(this.mode);
  }

  /** Every subpanel that shares the bottom-sheet dock spot, paired with the icon-column trigger row whose active state tracks "is this one open" — `undefined` for the camera trigger, whose active state means something else entirely (see toggleSubpanel's own doc comment). */
  private subpanelEntries(): { kind: 'camera' | 'dimmer' | 'glow' | 'lab'; panel: BottomSheetPanel; triggerId?: string }[] {
    return [
      { kind: 'camera', panel: this.cameraPanel },
      { kind: 'dimmer', panel: this.dimmerPanel, triggerId: 'mzj-planning-open-dimmer' },
      { kind: 'glow', panel: this.glowPanel, triggerId: 'mzj-planning-open-glow' },
      { kind: 'lab', panel: this.labPanel, triggerId: 'mzj-planning-open-lab' },
    ];
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
        // PROGRESS.md's remaining hard constraint for why this stays a real
        // (if invisible) DOM `<input type="file">`.
        onTap: () => this.bgImageInput.click(),
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
    this.iconColumn.container.visible = true;

    this.hintAutoHidden = false;
    this.applyHintVisibility(true);
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hintAutoHidden = true;
      this.applyHintVisibility(true);
    }, HINT_VISIBLE_MS);
  }

  hide(): void {
    this.iconColumn.container.visible = false;
    this.hintText.alpha = 0;
    window.clearTimeout(this.hintTimer);
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    // The camera trigger's active state means "a video background is set",
    // not "its panel is open" — it must survive closing/reopening the
    // screen, so it's the one entry below with no triggerId to reset (see
    // subpanelEntries()' own doc comment).
    for (const entry of this.subpanelEntries()) {
      entry.panel.setOpen(false);
      if (entry.triggerId) this.iconColumn.setActive(entry.triggerId, false);
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
    this.iconColumn.setActive('mzj-planning-mode-mass', mode === 'mass');
    this.iconColumn.setActive('mzj-planning-mode-sequential', mode === 'sequential');
    this.shapesPanel.setActive(this.computeActiveShapeIds());
    this.deps.onModeChange(mode);
  }

  private layoutHint(): void {
    const screen = this.deps.app.screen;
    this.hintText.position.set(screen.width / 2, screen.height - HINT_BOTTOM_INSET);
  }

  /** Composing snaps instantly (matches the old `display:none` rule, no transition); the auto-hide timer fades (matches the old `transition: opacity 0.5s ease`). */
  private applyHintVisibility(animate: boolean): void {
    const visible = !this.hintComposing && !this.hintAutoHidden;
    if (animate) this.fadeHint(visible);
    else this.hintText.alpha = visible ? 1 : 0;
  }

  private fadeHint(visible: boolean): void {
    const target = visible ? 1 : 0;
    const start = this.hintText.alpha;
    if (start === target) return;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / HINT_FADE_MS);
      this.hintText.alpha = start + (target - start) * t;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** The two file-picker bridges' shared build logic — see the class field's own doc comment for why this DOM node is unavoidable. Zero CSS: every property below is a direct inline `style.*` assignment, matching TextComposer's ghost-input rigor. */
  private buildFileInput(accept: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    for (const type of ['pointerdown', 'click', 'change'] as const) {
      input.addEventListener(type, (event) => event.stopPropagation());
    }
    document.body.appendChild(input);
    return input;
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
   * not a bottom-sheet subpanel — so each has to close every subpanel *and*
   * the other canvas panel itself (they'd otherwise stay open underneath
   * it), and toggleSubpanel() closes both whenever a subpanel opens.
   */
  private toggleColorPicker(): void {
    const willOpen = !this.colorPicker.open;
    this.closeAllSubpanels();
    this.shapesPanel.setOpen(false);
    this.colorPicker.setOpen(willOpen);
  }

  private toggleShapesPanel(): void {
    const willOpen = !this.shapesPanel.open;
    this.closeAllSubpanels();
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(willOpen);
  }

  private closeAllSubpanels(): void {
    for (const entry of this.subpanelEntries()) {
      entry.panel.setOpen(false);
      if (entry.triggerId) this.iconColumn.setActive(entry.triggerId, false);
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
  private toggleSubpanel(kind: 'camera' | 'dimmer' | 'glow' | 'lab'): void {
    const entries = this.subpanelEntries();
    const target = entries.find((entry) => entry.kind === kind)!;
    const willOpen = !target.panel.open;
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    for (const entry of entries) {
      const isTarget = entry.kind === kind;
      entry.panel.setOpen(isTarget && willOpen);
      if (entry.triggerId) this.iconColumn.setActive(entry.triggerId, isTarget && willOpen);
    }
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
    this.bgImageInput.addEventListener('change', () => {
      const file = this.bgImageInput.files?.[0];
      if (!file) return;
      void this.deps.background.setImage(file).then(() => {
        this.uploadHint.show('image');
        this.iconColumn.setActive('mzj-planning-bg-image', true);
      });
    });

    // CameraPickerPanel's "رفع فيديو"/"توثيق مباشر" choice buttons trigger
    // this same picker (see the panel's own constructor call above) — this
    // just handles what happens once the OS file dialog it opens resolves.
    this.bgVideoInput.addEventListener('change', () => {
      const file = this.bgVideoInput.files?.[0];
      if (!file) return;
      void this.deps.background.setVideo(file).then(() => {
        this.liveDocumentationArmed = false;
        this.uploadHint.show('video');
        this.iconColumn.setActive('mzj-planning-open-camera', true);
      });
    });
  }

  /**
   * "تسجيل فيديو"'s own tap is wired directly on its icon-column row (see
   * buildIconRowSpecs()) — this only handles the unsupported-browser case.
   * Starts/stops recording the show's actual output, a distinct concern
   * from "فيديو خلفية حي" right above it, which only picks the *input*
   * background media — stays usable at any time, including mid-show and
   * during plain free-tap play with no plan ever set up.
   */
  private wireRecording(): void {
    const canRecord = typeof MediaRecorder !== 'undefined' && typeof this.deps.app.canvas.captureStream === 'function';
    if (!canRecord) this.iconColumn.setDisabled('mzj-planning-record', true);
  }
}
