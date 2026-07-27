import { Text, TextStyle, type Application, type Container, type Ticker } from 'pixi.js';
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
import { BackdropControlsPanel } from './BackdropControlsPanel';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';
import { createHiddenFileInput } from '../dom/shadowServices';

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
  /** "مدفع" (inside ShapesPanel now, moved from the header): fires with the new mode every time the player toggles it. */
  onInputModeChange: (mode: InputMode) => void;
  /** "العرض التلقائي" toggled on/off — lets fireworksMood.ts treat continuous auto-launching as a third "launch screen" alongside متتابع/جماعي, showing the exit button for it too (see disableAutoShow()). */
  onAutoShowChange: (enabled: boolean) => void;
  /** Fires whenever the 'mass' selection changes (a shape queued/unqueued), passing the new hasMassSelection() value directly — lets fireworksMood.ts track it in a local flag instead of calling back into this class, since onModeChange (below) can run synchronously during this very constructor, before fireworksMood.ts's own `const planningScreen = new PlanningScreen(...)` has finished assigning. */
  onMassSelectionChange: (hasSelection: boolean) => void;
  /**
   * Forwards TextComposer's own onComposingChange straight through — lets
   * fireworksMood.ts hide its exit button (see updateExitButtonVisibility())
   * for exactly as long as the composer's own back arrow sits in that same
   * top-right corner, otherwise a real, confirmed pixel-for-pixel overlap
   * whenever text composing overlaps any other exitButton-visible state
   * (sequential mode armed, a mass selection queued, an auto-show running).
   * Unlike onModeChange, safe to fire synchronously here — TextComposer
   * never calls its own onComposingChange during construction, only from
   * open()/commit()/consumeForReveal(), none of which run until the player
   * actually taps something.
   */
  onTextComposingChange?: (composing: boolean) => void;
}

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

// Initial handle positions must match FireworksSystem's own
// DEFAULT_BURST_SETTINGS (burstTypes.ts) — these are two independent
// literals (the slider doesn't read the engine's defaults back), so a
// change to one without the other would show a slider sitting somewhere
// the engine isn't actually starting from.
const SLIDERS = {
  density: { label: 'كثافة الجسيمات', min: 50, max: 500, step: 1, value: 320 },
  gravity: { label: 'شدة الجاذبية', min: 0, max: 2, step: 0.05, value: 0.6 },
  lifespan: { label: 'عمر الجسيمات', min: 0.4, max: 2.5, step: 0.05, value: 1.7 },
  scale: { label: 'اتساع الانفجار', min: 0.5, max: 2, step: 0.05, value: 1 },
  glow: { label: 'توهج الألعاب النارية', min: 0, max: 10, step: 0.5, value: 0 },
} satisfies Record<string, SliderSpec>;

/** Matches DEFAULT_BURST_SETTINGS-style sync note above: BackgroundLayer's own `dimmer` field starts at 1 (background.ts) — this has to start there too. */
const DIMMER_INITIAL_VALUE = 1;

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
  private readonly backdropControls: BackdropControlsPanel;
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
  /** True once the player has picked "العرض التلقائي" — does NOT start the engine's continuous auto-launch by itself anymore (see setAutoShow()'s own doc comment); only "ابدأ العرض" (beginShow() in fireworksMood.ts) actually starts it, same gating mass/sequential already had. */
  private autoShowArmed = false;
  private hintTimer: TickerTimerHandle | undefined;
  private hintFadeTick: ((t: Ticker) => void) | undefined;
  private hintComposing = false;
  private hintAutoHidden = true;
  /** True while the main icon column is slid away because the player is actively placing a shot/pin (see hideChromeThenRun()/isChromeHidden()) — distinct from `hide()`'s own full screen-exit collapse. */
  private chromeHidden = false;
  /**
   * Which side panel (if any) the player last deliberately opened via its
   * own main-column trigger icon — kept even after the panel auto-closes
   * itself on a confirmed pick (ShapesPanel.pick()/ColorPickerPanel.select()
   * both call their own setOpen(false) internally), so the right-to-left
   * swipe-reveal gesture (see revealChrome()) can still bring it back. Only
   * cleared by re-tapping the same trigger icon to close it deliberately, or
   * by fully entering/exiting the planning screen (show()/hide()).
   */
  private lastActivePanelKind: 'camera' | 'glow' | 'lab' | 'shapes' | 'color' | null = null;

  constructor(deps: PlanningScreenDeps) {
    this.deps = deps;

    this.bgImageInput = createHiddenFileInput('image/*');
    this.bgVideoInput = createHiddenFileInput('video/*');

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
      (open) => {
        this.iconColumn.setActive('mzj-planning-open-shapes', open);
        this.syncBackdropControlsVisibility();
      },
      (type) => this.handlePickShape(type),
      () => this.handleToggleGroundFountain(),
      () => this.handleToggleMortarMode(),
    );
    deps.uiContainer.addChild(this.shapesPanel.container);

    // "فيديو خلفية حي" + "صورة خلفية" + the bare vertical brightness fader —
    // moved out of the main icon column into their own floating group (see
    // BackdropControlsPanel's own doc comment) so their visibility can
    // follow the player's actual planning context (see
    // syncBackdropControlsVisibility()) instead of the column's own
    // hide/show state.
    this.backdropControls = new BackdropControlsPanel({
      app: deps.app,
      onTapVideo: () => this.toggleSubpanel('camera'),
      onTapImage: () => this.bgImageInput.click(),
      dimmerInitialValue: DIMMER_INITIAL_VALUE,
      onDimmerChange: (v) => deps.background.setDimmer(v),
    });
    deps.uiContainer.addChild(this.backdropControls.container);

    // The three remaining bottom-sheet subpanels (see PlanningSubpanels.ts /
    // BottomSheetPanel) — fully Pixi, no more `.mzj-planning-subpanel` DOM.
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
            this.backdropControls.setVideoActive(true);
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
        this.deps.onTextComposingChange?.(composing);
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
  private subpanelEntries(): { kind: 'camera' | 'glow' | 'lab'; panel: BottomSheetPanel; triggerId?: string }[] {
    return [
      { kind: 'camera', panel: this.cameraPanel },
      { kind: 'glow', panel: this.glowPanel, triggerId: 'mzj-planning-open-glow' },
      { kind: 'lab', panel: this.labPanel, triggerId: 'mzj-planning-open-lab' },
    ];
  }

  /**
   * Every row's behavior, ported 1:1 from the old DOM buttons' `click`
   * listeners — see PlanningIconColumn for how these actually render/hit-
   * test. Subpanel triggers (camera/glow/lab) still open the existing HTML
   * subpanels for now (next pass in PROGRESS.md); the shapes/color triggers
   * already open fully-Pixi SideDockPanels.
   */
  private buildIconRowSpecs(): IconRowSpec[] {
    return [
      { id: 'mzj-planning-auto-show', icon: 'sparkles', label: 'العرض التلقائي', onTap: () => this.hideChromeThenRun(() => this.toggleAutoShow()) },
      { id: 'mzj-planning-open-lab', icon: 'sliders', label: 'المختبر', onTap: () => this.hideChromeThenRun(() => this.toggleSubpanel('lab')) },
      { id: 'mzj-planning-open-text', icon: 'T', label: 'نص', onTap: () => this.hideChromeThenRun(() => this.textComposer.open()) },
      { id: 'mzj-planning-random-mode', icon: 'shuffle', label: 'توليد عشوائي هجين', onTap: () => this.hideChromeThenRun(() => this.toggleRandomMode()) },
      { id: 'mzj-planning-mode-mass', icon: 'fireworksMood', label: 'إطلاق جماعي', onTap: () => this.hideChromeThenRun(() => this.setMode('mass')) },
      { id: 'mzj-planning-mode-sequential', icon: 'mapPin', label: 'إطلاق متتابع', onTap: () => this.hideChromeThenRun(() => this.setMode('sequential')) },
      { id: 'mzj-planning-open-shapes', icon: 'shapes', label: 'الأشكال', onTap: () => this.hideChromeThenRun(() => this.toggleShapesPanel()) },
      { id: 'mzj-planning-record', icon: 'recordDot', label: 'تسجيل فيديو', onTap: () => this.hideChromeThenRun(() => this.deps.onToggleRecording()) },
      // "فيديو خلفية حي" and "صورة خلفية" no longer live here — see
      // BackdropControlsPanel's own doc comment for why they moved into
      // their own floating group, synced to shapes/random/auto-show
      // context instead of the main column's own hide/show state.
      { id: 'mzj-planning-open-glow', icon: 'gem', label: 'توهج الألعاب النارية', onTap: () => this.hideChromeThenRun(() => this.toggleSubpanel('glow')) },
      { id: 'mzj-planning-open-color', icon: 'droplet', label: 'لون المقذوفة', onTap: () => this.hideChromeThenRun(() => this.toggleColorPicker()) },
    ];
  }

  /**
   * Rule shared by every row above: touching *any* main-column icon slides
   * the whole column away immediately (see PlanningIconColumn.setChromeVisible),
   * whether or not it happens to open a side panel — then runs the row's own
   * actual action. See revealChrome() for how the swipe gesture undoes this.
   */
  private hideChromeThenRun(action: () => void): void {
    this.chromeHidden = true;
    this.iconColumn.setChromeVisible(false);
    action();
  }

  /**
   * "فيديو خلفية حي"/"صورة خلفية" + the brightness fader (see
   * BackdropControlsPanel) show together whenever the player is in an
   * active planning/launch context — "الأشكال" open (the most-used panel
   * during planning), "توليد عشوائي هجين" toggled, or "العرض التلقائي"
   * armed — and hide the instant none of those hold, independently of the
   * main column's own hide/show state (see hideChromeThenRun() above, which
   * deliberately does NOT touch this group at all). Forced fully closed
   * during an actual running show — see hide()'s own explicit setOpen(false).
   */
  private syncBackdropControlsVisibility(): void {
    this.backdropControls.setOpen(this.shapesPanel.open || this.randomModeEnabled || this.autoShowArmed);
  }

  /** True while placing a shot/pin with the chrome slid away — fireworksMood.ts/PlanningMode check this to know a raw pointerdown might be a swipe-reveal rather than a tap-to-fire/place. */
  isChromeHidden(): boolean {
    return this.chromeHidden;
  }

  /**
   * The right-to-left swipe gesture: brings back both the main icon column
   * *and* whichever side panel was last deliberately opened (if any), so the
   * player always has a full second chance at any icon in either panel — see
   * lastActivePanelKind's own doc comment for why that memory survives a
   * panel's own auto-close-on-pick.
   */
  revealChrome(): void {
    if (!this.chromeHidden) return;
    this.chromeHidden = false;
    this.iconColumn.setChromeVisible(true);
    if (this.lastActivePanelKind === 'shapes') {
      this.shapesPanel.setOpen(true);
    } else if (this.lastActivePanelKind === 'color') {
      this.colorPicker.setOpen(true);
    } else if (this.lastActivePanelKind) {
      const entry = this.subpanelEntries().find((e) => e.kind === this.lastActivePanelKind);
      if (entry) {
        entry.panel.setOpen(true);
        if (entry.triggerId) this.iconColumn.setActive(entry.triggerId, true);
      }
    }
  }

  /** Called by fireworksMood.ts once a recording actually starts/stops, to sync the icon. */
  setRecordingState(isRecording: boolean): void {
    this.iconColumn.setRecording(isRecording);
  }

  show(mode: LaunchMode): void {
    this.chromeHidden = false;
    this.lastActivePanelKind = null;
    this.iconColumn.resetChromeVisible();
    this.applyMode(mode);
    this.iconColumn.container.visible = true;
    this.reshowHint();
    // randomModeEnabled/autoShowArmed persist across hide()/show() (they're
    // independent toggles, not reset here) — re-sync so backdropControls
    // reappears immediately if either was already on before this restore.
    this.syncBackdropControlsVisibility();
  }

  /** Restarts the hint's visible-then-auto-fade cycle — shared by show() (mood boot / endShow() restore) and setMode() (the player just picked a launch mode and needs guiding to the next step). */
  private reshowHint(): void {
    this.hintAutoHidden = false;
    this.applyHintVisibility(true);
    this.hintTimer?.cancel();
    this.hintTimer = tickerSetTimeout(this.deps.app.ticker, () => {
      this.hintAutoHidden = true;
      this.applyHintVisibility(true);
    }, HINT_VISIBLE_MS);
  }

  hide(): void {
    this.chromeHidden = false;
    this.lastActivePanelKind = null;
    this.iconColumn.resetChromeVisible();
    this.iconColumn.container.visible = false;
    this.stopHintFade();
    this.hintText.alpha = 0;
    this.hintTimer?.cancel();
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(false);
    this.backdropControls.setOpen(false);
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

  /** Icon-highlight + shapesPanel active-set sync only — no panel-opening/hint side effects, safe to call from show()'s mood-boot/endShow-restore path where popping الأشكال open unprompted would be jarring. */
  private applyMode(mode: LaunchMode): void {
    this.mode = mode;
    this.iconColumn.setActive('mzj-planning-mode-mass', mode === 'mass');
    this.iconColumn.setActive('mzj-planning-mode-sequential', mode === 'sequential');
    this.shapesPanel.setActive(this.computeActiveShapeIds());
    this.deps.onModeChange(mode);
  }

  /** The player just tapped "إطلاق جماعي"/"إطلاق متتابع" — switches the plan AND immediately opens الأشكال (closing every other panel first, same as toggleShapesPanel()) with the hint re-surfaced, so the very next thing on screen is "now pick a shape". */
  private setMode(mode: LaunchMode): void {
    this.applyMode(mode);
    this.closeAllSubpanels();
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(true);
    this.lastActivePanelKind = 'shapes';
    this.reshowHint();
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

  private stopHintFade(): void {
    if (this.hintFadeTick) this.deps.app.ticker.remove(this.hintFadeTick);
    this.hintFadeTick = undefined;
  }

  private fadeHint(visible: boolean): void {
    this.stopHintFade();
    const target = visible ? 1 : 0;
    const start = this.hintText.alpha;
    if (start === target) return;
    let elapsedMs = 0;
    const tick = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / HINT_FADE_MS);
      this.hintText.alpha = start + (target - start) * progress;
      if (progress >= 1) this.stopHintFade();
    };
    this.hintFadeTick = tick;
    this.deps.app.ticker.add(tick);
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
    // Re-surfaces the "اختر الشكل وحدد موقعه" reminder on every pick, not
    // just the initial mode tap — same treatment setMode() gives it.
    this.reshowHint();
    this.deps.onMassSelectionChange(this.hasMassSelection());
  }

  /** Abandons whatever plan hasn't fired yet — the exit button calls this (via fireworksMood.ts's endShow()) when it's cancelling a pending mass selection rather than ending an already-fired show, so a forgotten queued shape can't silently carry over into a later, unrelated "ابدأ العرض" press. */
  clearPendingSelection(): void {
    this.massSelection.clear();
    this.activeSequentialShape = null;
    this.shapesPanel.setActive(this.computeActiveShapeIds());
  }

  /**
   * True once 'mass' mode has at least one shape queued for launch-
   * together. Sequential mode's own equivalent lock already lives in
   * PlanningMode.isActive (armed the instant that mode is chosen, even
   * before a shape/pin exists) — this covers the one real gap: mass mode
   * had no lock at all, so a stray tap after queuing a shape fired an
   * ordinary, unrelated free rocket instead of respecting the plan the
   * player was actively building. Used by fireworksMood.ts's stage tap
   * handler to suspend free-tap-fire until "ابدأ العرض" actually launches
   * the queued shapes (or the plan is abandoned via the exit button).
   */
  hasMassSelection(): boolean {
    return this.mode === 'mass' && this.massSelection.size > 0;
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
    this.lastActivePanelKind = willOpen ? 'color' : null;
  }

  private toggleShapesPanel(): void {
    const willOpen = !this.shapesPanel.open;
    this.closeAllSubpanels();
    this.colorPicker.setOpen(false);
    this.shapesPanel.setOpen(willOpen);
    this.lastActivePanelKind = willOpen ? 'shapes' : null;
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
    this.syncBackdropControlsVisibility();
  }

  private toggleAutoShow(): void {
    this.setAutoShow(!this.autoShowArmed);
  }

  /**
   * Arms/disarms "العرض التلقائي" only — does NOT touch the engine's
   * continuous auto-launch itself anymore. Same gating mass/sequential mode
   * selection already has: picking a mode never fires anything by itself,
   * only "ابدأ العرض" (beginShow() in fireworksMood.ts) actually starts
   * firing, giving the player a chance to set up text/background first
   * regardless of which launch style they picked. Disarming is still a safe
   * moment to force the engine off directly, in case it happened to be
   * running (e.g. the exit button cancelling mid-show via disableAutoShow()).
   */
  private setAutoShow(enabled: boolean): void {
    this.autoShowArmed = enabled;
    if (!enabled) this.deps.fireworks.setAutoLaunch(false);
    this.iconColumn.setActive('mzj-planning-auto-show', enabled);
    this.deps.onAutoShowChange(enabled);
    this.syncBackdropControlsVisibility();
  }

  /** True once armed — fireworksMood.ts's beginShow() checks this to know whether "ابدأ العرض" should also start the engine's continuous auto-launch alongside whatever mass/sequential plan is active. */
  isAutoShowArmed(): boolean {
    return this.autoShowArmed;
  }

  /** External off-switch for "العرض التلقائي" — the exit button (see fireworksMood.ts's endShow()) must be able to fully stop/disarm it too, not just the icon-column toggle: it now governs every launch screen (متتابع/جماعي/عشوائي), not only the planned-show flow. A no-op if it's already off. */
  disableAutoShow(): void {
    if (this.autoShowArmed) this.setAutoShow(false);
  }

  /**
   * All subpanels/pickers share the same on-screen spot, so opening one must
   * close the rest. The camera trigger's own active state is deliberately
   * left alone here — for it, "active" means "a video background is
   * currently set" (see wireMedia), not "this panel happens to be open".
   */
  private toggleSubpanel(kind: 'camera' | 'glow' | 'lab'): void {
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
    this.lastActivePanelKind = willOpen ? kind : null;
  }

  /**
   * The camera icon is the single entry point for both background-video
   * paths: tapping it opens a small picker with "رفع فيديو" (existing file
   * upload) and "توثيق مباشر" (new — live device camera as the backdrop,
   * armed here so beginShow() auto-starts/stops recording around it).
   */
  private wireMedia(): void {
    // "صورة خلفية"'s own tap (opening the native file picker) lives on
    // BackdropControlsPanel now — see its onTapImage wiring in the constructor.
    this.bgImageInput.addEventListener('change', () => {
      const file = this.bgImageInput.files?.[0];
      if (!file) return;
      // Rejects on a corrupt/unsupported image file (createDecodedImageElement's
      // own image.decode() call) — caught here, same as the live-camera
      // handler above, instead of an unhandled promise rejection with no
      // feedback at all when a player picks a bad file.
      void this.deps.background
        .setImage(file)
        .then(() => {
          this.uploadHint.show('image');
          this.backdropControls.setImageActive(true);
        })
        .catch((error) => {
          console.error('تعذّر تحميل صورة الخلفية (الملف تالف أو غير مدعوم):', error);
        });
    });

    // CameraPickerPanel's "رفع فيديو"/"توثيق مباشر" choice buttons trigger
    // this same picker (see the panel's own constructor call above) — this
    // just handles what happens once the OS file dialog it opens resolves.
    this.bgVideoInput.addEventListener('change', () => {
      const file = this.bgVideoInput.files?.[0];
      if (!file) return;
      void this.deps.background
        .setVideo(file)
        .then(() => {
          this.liveDocumentationArmed = false;
          this.uploadHint.show('video');
          this.backdropControls.setVideoActive(true);
        })
        .catch((error) => {
          console.error('تعذّر تحميل فيديو الخلفية (الملف تالف أو غير مدعوم):', error);
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
