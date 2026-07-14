import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { BackdropBlurFilter } from 'pixi-filters';
import { iconTexture } from '../ui/svgIconTexture';
import { FireworksSystem } from '../fireworks/FireworksSystem';
import { TextReveal } from '../effects/TextReveal';
import { MortarField } from '../effects/MortarField';
import { ScreenFlash } from '../effects/ScreenFlash';
import { ShockwaveManager } from '../effects/Shockwave';
import { ScreenShakeManager } from '../effects/ScreenShake';
import { AudioManager } from '../audio/AudioManager';
import { RecordingManager, downloadBlob } from '../recording/RecordingManager';
import { BackgroundLayer } from '../background';
import { HeaderBar } from '../ui/HeaderBar';
import { IdleFadeController } from '../ui/IdleFade';
import { withTimeout } from '../utils/withTimeout';
import { PlanningMode } from '../ui/PlanningMode';
import { PlanningScreen, type InputMode } from '../ui/PlanningScreen';

export interface FireworksMoodHandle {
  show(): void;
  hide(): void;
}

// Royal black: a deep, rich near-black backdrop for the fireworks stage.
const ROYAL_BLACK = '#040406';

/**
 * Boots the fireworks mood inside `container` (expects the #app markup
 * already in place, see index.html) and wires the "back to home" callback
 * into the header. Called once, lazily, the first time the player picks this
 * mood from the home screen; subsequent visits just call `show()`/`hide()`.
 *
 * Tap-to-fire is live the instant the mood opens — there's no setup gate.
 * The header's pin-icon button opens the full-screen planning layout (see
 * PlanningScreen) for the mass/sequential planned-launch flow. "ابدأ العرض"
 * is a deliberate, one-time action: it fires whatever plan is active (see
 * `launchPlannedShow()`), plays the opening phrase reveal, and switches into
 * the fully-immersive (UI-hidden) viewing mode, all in one call.
 */
export async function startFireworksMood(container: HTMLElement, onBackToHome: () => void): Promise<FireworksMoodHandle> {
  const appContainer = container.querySelector<HTMLDivElement>('#app')!;

  const app = new Application();

  await app.init({
    resizeTo: window,
    background: ROYAL_BLACK,
    backgroundAlpha: 1,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
    // Needed so canvas.captureStream() (video recording) sees fresh frames
    // instead of an already-cleared WebGL buffer.
    preserveDrawingBuffer: true,
  });

  appContainer.appendChild(app.canvas);

  // --- Container tree: worldContainer (captured content) vs. uiContainer (chrome) ---
  //
  // Everything used to be added directly to `app.stage`, which meant
  // `extract.base64({target: app.stage})` (see takeSnapshot() below) baked
  // the entire header/icon-column/panels/hint/toast into every exported
  // snapshot — discovered while converting the camera flash to Pixi, since
  // that was the first object that genuinely needed excluding from a
  // capture. Two dedicated layers fix this at the source:
  //   - `worldContainer` (added first, so it renders behind): the actual
  //     show — background, fireworks/mortar particles, the ambient
  //     explosion flash, the real text reveal, and TextComposer's own
  //     *committed* text. This is the only thing takeSnapshot() targets.
  //   - `uiContainer` (added second, renders on top): every control —
  //     header, icon column, side/bottom panels, the composing-time text
  //     toolbar, the hint, the upload toast, planning-mode's placement
  //     pins, and the camera-flash overlay itself (a real phone camera's
  //     own screen flash never appears in the photo it takes, so it
  //     belongs here, not in worldContainer — see flashScreen() below).
  //
  // `canvas.captureStream()`-based video recording (see RecordingManager)
  // reads raw canvas pixels below Pixi's scene graph entirely, so this split
  // alone cannot exclude UI chrome from *recordings* the way it does for
  // snapshots — that needs its own worldContainer-only pixel source, fed to
  // captureStream instead of the main canvas. See the `recordCanvas` block
  // below for the (non-obvious) way that's actually done safely.
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);
  // `isRenderGroup: true` — uiContainer's own subtree (header, icon column,
  // every panel, the text-composer toolbar) gets its own cached set of GPU
  // render instructions, independent of worldContainer's constantly-changing
  // particle counts. Without it, every UI element (mostly static between
  // frames) would be re-batched alongside the fireworks simulation on every
  // single frame; with it, Pixi only rebuilds uiContainer's batches when
  // something inside uiContainer itself actually changes.
  const uiContainer = new Container({ isRenderGroup: true });
  app.stage.addChild(uiContainer);

  // --- A worldContainer-only pixel source for video recording ---
  //
  // `canvas.captureStream()` (RecordingManager, see startRecording() below)
  // reads raw pixels from whatever canvas it's given, below Pixi's scene
  // graph entirely — the worldContainer/uiContainer split above cannot
  // exclude anything from it the way it does for takeSnapshot()'s
  // `extract.base64({target: worldContainer})`.
  //
  // A second, independent `autoDetectRenderer()`/WebGL-context surface was
  // tried first and rejected: Pixi v8's per-object GPU resource caches
  // (geometry/texture bindings, filter render-textures) are built against
  // whichever renderer first touches a given display object, so handing the
  // *same* worldContainer instances to a second, separate WebGLRenderer
  // silently produced a blank canvas — proven via a debug hook that read
  // recordCanvas pixels directly (bypassing MediaRecorder/webm entirely): a
  // bare, never-before-rendered Graphics rendered fine on the second
  // renderer, but every real worldContainer child (already rendered every
  // frame by `app.renderer`) came back solid black, with no thrown error.
  //
  // The fix that's actually safe is to stay on the *same* renderer/context
  // `app.renderer` already uses for the main canvas — the exact code path
  // `takeSnapshot()` already proved clean of UI chrome — and blit its output
  // onto a plain 2D `recordCanvas` every frame while a recording is running
  // (see the app.ticker callback below). `renderer.extract.canvas()` is
  // documented as "relatively expensive" per-call, but it only ever runs
  // while the player has explicitly started a recording, so that cost is
  // scoped to exactly when it's needed.
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = app.screen.width * app.renderer.resolution;
  recordCanvas.height = app.screen.height * app.renderer.resolution;
  const recordCtx = recordCanvas.getContext('2d')!;
  // A fixed viewport rect, not the default tight bounding box around
  // worldContainer's current contents — particles/background constantly
  // move, so an auto-fit frame would resize/shift every single extracted
  // frame instead of producing a stable video.
  let worldExtractFrame = new Rectangle(0, 0, app.screen.width, app.screen.height);
  app.renderer.on('resize', () => {
    recordCanvas.width = app.screen.width * app.renderer.resolution;
    recordCanvas.height = app.screen.height * app.renderer.resolution;
    worldExtractFrame = new Rectangle(0, 0, app.screen.width, app.screen.height);
  });

  const background = new BackgroundLayer(app, worldContainer);

  const audio = new AudioManager(app);
  // Fire-and-forget: unlocking must never block the panel from appearing,
  // and it's still within the same user-initiated call chain that opened
  // this mood (the browser's autoplay-gesture leniency covers this).
  void audio.unlock().then(() => {
    if (audio.hasMissingSounds()) {
      console.info('أضف ملفات الصوت في public/audio/ لتفعيل المؤثرات الصوتية (راجع public/audio/README.md).');
    }
  });
  const mortarField = new MortarField(app);
  worldContainer.addChild(mortarField.container);
  const explosionFlash = new ScreenFlash(app);
  worldContainer.addChild(explosionFlash.graphics);
  const shockwave = new ShockwaveManager(app, worldContainer);
  const screenShake = new ScreenShakeManager(worldContainer);

  let inputMode: InputMode = 'tap';

  const fireworks = new FireworksSystem(app, {
    autoLaunch: false,
    onLaunch: (x) => {
      audio.playLaunch();
      mortarField.fireNear(x);
    },
    onExplode: (x, y, intensity) => {
      audio.playExplosion(x, y);
      explosionFlash.flash();
      shockwave.trigger(x, y);
      screenShake.trigger(intensity);
    },
  });
  worldContainer.addChild(fireworks.layer);

  const textReveal = new TextReveal(app);
  worldContainer.addChild(textReveal.container);
  // recordCanvas, not app.canvas — see this file's own "worldContainer-only
  // pixel source" doc comment above for why the recorded stream must come
  // from the world-only extraction instead of the main (world+UI) canvas.
  const recording = new RecordingManager(recordCanvas, audio.getRecordingStream());

  /** What a tap normally does: aerial burst, or a Ground Fountain if that mode is active. */
  function fireAt(x: number, y: number): void {
    if (fireworks.isGroundFountainMode()) {
      fireworks.igniteGroundFountain(x, y);
      const stopSizzle = audio.startFountainSizzle();
      window.setTimeout(stopSizzle, 5000);
      return;
    }
    fireworks.launch(x, y);
  }

  // Nothing covers the stage anymore (the old tabbed dashboard is gone), so
  // the reachable planning area is always the full screen.
  function getVisibleRange(): { top: number; height: number } {
    return { top: 0, height: app.screen.height };
  }

  // Sequential-mode's placement engine: armed only while the planning
  // screen's mode is 'sequential' (see the onModeChange wiring below), and
  // owns its own stage pointer listeners directly (long-press-to-cancel
  // needs pointerdown/move/up, not just a single tap callback). onComplete
  // is threaded straight through to FireworksSystem.launch()'s own
  // onComplete, which fires only once that shot's explosion has genuinely
  // finished (every descendant particle faded) — see launchPlannedShow().
  const planningMode = new PlanningMode({
    app,
    onLaunchPin: (x, y, type, onComplete) => fireworks.launch(x, y, type, onComplete),
    getVisibleRange,
    getActiveShape: () => planningScreen.getActiveSequentialShape(),
    // Same مدفع/حر targeting mode as ordinary free-tap firing below — a
    // sequential pin lands wherever a normal shot would from the same tap.
    resolveX: (x) => (inputMode === 'mortar' ? mortarField.getNearestX(x) : x),
  });
  uiContainer.addChild(planningMode.layer);

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.renderer.on('resize', () => {
    app.stage.hitArea = app.screen;
  });

  // Free Tap fires exactly where the player touches; Mortar Field snaps the
  // launch x to whichever tube is closest, for a more "grounded" show. Tap-
  // to-fire is live the instant the mood opens — no separate "start" gate —
  // right up until "ابدأ العرض" actually fires the planned show: from then
  // on every other input is locked (see beginShow()/endShow()) so nothing
  // interferes with the planned sequence; the exit button is the one
  // deliberate exception, wired on its own listener with its own
  // stopPropagation, independent of this handler entirely. While sequential
  // planning is active, PlanningMode's own listeners (see above) handle
  // every tap instead — this handler steps aside entirely.
  app.stage.on('pointerdown', (event) => {
    if (showStarted || planningMode.isActive) return;
    const { x, y } = event.global;
    const launchX = inputMode === 'mortar' ? mortarField.getNearestX(x) : x;
    fireAt(launchX, y);
  });

  app.ticker.add((ticker) => {
    fireworks.update(ticker.deltaTime);
    mortarField.update(ticker.deltaTime);
    textReveal.update(ticker.deltaTime);
    explosionFlash.update(ticker.deltaMS / 1000);
    shockwave.update(ticker.deltaMS / 1000);
    screenShake.update(ticker.deltaMS / 1000);
    // Only while a recording is actually running — extracting worldContainer
    // a second time every frame is real, avoidable GPU/CPU cost, so it stays
    // off during ordinary play. See recordCanvas's own doc comment above.
    if (recording.isRecording) {
      const frame = app.renderer.extract.canvas({
        target: worldContainer,
        frame: worldExtractFrame,
        resolution: app.renderer.resolution,
      });
      recordCtx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
      recordCtx.drawImage(frame as unknown as CanvasImageSource, 0, 0);
    }
  });

  // "ابدأ العرض" plays the opening phrase reveal, then switches into full
  // immersion. `showStarted` just guards against a double-press while a show
  // is already running — pressing "ابدأ العرض" again after the player has
  // actually exited (see endShow() below) is a real, working restart:
  // endShow() clears the previous reveal's sprites before handing back
  // control, so a second reveal has a clean slate to play into.
  const FALLBACK_GREETING = 'مبروك';
  let showStarted = false;
  // Mirrors PlanningScreen's own "العرض التلقائي" state — the exit button
  // must stay visible for this continuous-launch screen too, not just the
  // planned-show flow (see updateExitButtonVisibility() below).
  let autoShowActive = false;

  // Neither mode icon in the planning screen fires anything itself — this is
  // the one and only trigger, per the confirmed spec: mass launches every
  // selected shape together, superimposed at one shared point (there's no
  // location step for 'mass'); sequential fires PlanningMode's placed pins,
  // each 800ms apart in the order they were placed. Whichever mode wasn't
  // active when the player pressed the button is simply ignored, even if it
  // has leftover selections from earlier experimentation. `onAllComplete`,
  // if given, fires once every fired shot's explosion has genuinely finished
  // playing (every descendant particle faded) — not on any fixed delay —
  // used to auto-stop توثيق مباشر's recording exactly when the show ends.
  function launchPlannedShow(onAllComplete?: () => void): void {
    if (planningScreen.getMode() === 'mass') {
      const types = planningScreen.getMassSelection();
      if (types.length === 0) {
        onAllComplete?.();
        return;
      }

      let remaining = types.length;
      const markOneDone = onAllComplete
        ? () => {
            remaining--;
            if (remaining <= 0) onAllComplete();
          }
        : undefined;

      const centerX = app.screen.width / 2;
      const centerY = app.screen.height * 0.35;
      for (const type of types) fireworks.launch(centerX, centerY, type, markOneDone);
      return;
    }

    planningMode.launch(onAllComplete);
  }

  function beginShow(): void {
    if (showStarted) return;
    showStarted = true;

    // توثيق مباشر (live camera) auto-records for exactly the planned show's
    // real runtime — recording starts now and stops the instant every fired
    // shot's explosion has actually finished (see launchPlannedShow()'s
    // onAllComplete), never on a guessed delay. Nothing else about recording
    // changes if it wasn't chosen — "تسجيل فيديو" in the planning list keeps
    // working exactly as before.
    if (planningScreen.isLiveDocumentationArmed()) {
      void startRecording();
      launchPlannedShow(() => void stopRecording());
    } else {
      launchPlannedShow();
    }

    // The planning screen must never still be up once the show begins,
    // whether or not the player closed it themselves first.
    planningScreen.hide();

    // Uses whatever the player set up via the "T" icon (text, effect,
    // position, scale); falls back to the plain default only if they never
    // touched it at all this session — see TextComposer.consumeForReveal().
    const textConfig = planningScreen.consumeTextRevealConfig();
    audio.playReveal();
    void withTimeout(
      textConfig
        ? textReveal.reveal(textConfig.text, textConfig)
        : textReveal.reveal(FALLBACK_GREETING),
      5000,
      'TextReveal.reveal',
    ).catch((error) => {
      console.error('تعذّر عرض عبارة الافتتاح (سيستمر العرض على أي حال):', error);
    });

    // Full-immersion: go straight to the completely-hidden state instead of
    // leaving the UI visible for the first idle timeout. The player brings
    // the header back at any moment with the existing tap/move-to-reveal
    // behaviour (IdleFadeController); the exit button below is the
    // deliberate, always-visible way back to the planning/idle state itself.
    idleFade.hideNow();
    updateExitButtonVisibility();
  }

  /**
   * The show's one deliberate, always-visible way out — the exit button
   * below calls this directly on tap. Everything happens synchronously, in
   * the same frame: no setTimeout, no fade-then-cleanup-later, nothing left
   * to race. Mirrors beginShow()'s setup in reverse, so a player can start
   * another show immediately after. Also the one control that governs every
   * launch screen (متتابع/جماعي/عشوائي, not just the planned-show flow) —
   * see updateExitButtonVisibility()'s own doc comment.
   */
  function endShow(): void {
    fireworks.clearActive();
    // A sequential show's staggered per-pin setTimeouts (see PlanningMode's
    // own doc comment) keep running past this point otherwise — a real leak
    // a field test caught: rockets kept firing on the idle screen after the
    // player had already exited.
    planningMode.cancelPending();
    if (recording.isRecording) void stopRecording();
    textReveal.clear();
    header.resetStartShowButton();
    idleFade.disarmAndShow();
    planningScreen.show(planningScreen.getMode());
    // Exit is the one control governing every launch screen now, not just
    // the planned-show flow — pressing it stops عشوائي too.
    planningScreen.disableAutoShow();
    showStarted = false;
    updateExitButtonVisibility();
  }

  // --- Camera-style flash + snapshot/recording ---

  // A genuine Pixi full-screen white overlay (the old #mzj-flash div's
  // replacement) — same "one shared Graphics, drive alpha per-frame"
  // technique as ScreenFlash.ts's rocket-explosion flash, just a single-shot
  // ease-out fade instead of that one's additive decay. `FLASH_FADE_MS=400`
  // matches the old `transition: opacity 400ms ease-out` exactly; the eased
  // cubic curve below is the standard ease-out approximation. Lives in
  // `uiContainer` (see this file's own container-tree doc comment above) —
  // a real phone camera's own screen flash never appears in the photo it
  // takes, and now that it's excluded structurally (takeSnapshot() below
  // only ever targets `worldContainer`), no timing-sensitive
  // remove/re-add dance around the capture is needed at all.
  const FLASH_FADE_MS = 400;
  const cameraFlash = new Graphics();
  cameraFlash.alpha = 0;
  cameraFlash.eventMode = 'none';
  uiContainer.addChild(cameraFlash);
  function redrawCameraFlash(): void {
    const { width, height } = app.screen;
    cameraFlash.clear().rect(0, 0, width, height).fill({ color: 0xffffff });
  }
  redrawCameraFlash();
  app.renderer.on('resize', () => redrawCameraFlash());

  function flashScreen(): void {
    cameraFlash.alpha = 1;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / FLASH_FADE_MS);
      const eased = 1 - (1 - t) ** 3;
      cameraFlash.alpha = 1 - eased;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function takeSnapshot(): Promise<void> {
    flashScreen();
    try {
      // Targets worldContainer exclusively — see this file's own
      // container-tree doc comment. Every UI control (including the flash
      // above) lives in the sibling uiContainer and is structurally
      // invisible to this capture.
      const dataUrl = await app.renderer.extract.base64({
        target: worldContainer,
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

  async function startRecording(): Promise<void> {
    if (recording.isRecording) return;
    try {
      recording.start();
      planningScreen.setRecordingState(true);
    } catch (error) {
      console.error('تعذّر بدء التسجيل:', error);
    }
  }

  async function stopRecording(): Promise<void> {
    if (!recording.isRecording) return;
    try {
      const blob = await recording.stop();
      downloadBlob(blob, `mazaj-fireworks-${Date.now()}.webm`);
    } catch (error) {
      console.error('تعذّر إنهاء التسجيل:', error);
    } finally {
      planningScreen.setRecordingState(false);
    }
  }

  async function toggleRecording(): Promise<void> {
    if (recording.isRecording) await stopRecording();
    else await startRecording();
  }

  // Assigned below; referenced here only inside a callback that can't run
  // until after this function has finished setting everything up.
  let handle!: FireworksMoodHandle;

  const header = new HeaderBar({
    app,
    audio,
    onStartShow: () => beginShow(),
    onBackToHome: () => {
      handle.hide();
      onBackToHome();
    },
  });
  uiContainer.addChild(header.container);

  // Always visible the instant the mood boots — see PlanningScreen's own
  // doc-comment for the full architecture. Every control that has a real,
  // already-built function behind it is wired directly here to
  // `fireworks`/`background`.
  const planningScreen = new PlanningScreen({
    app,
    audio,
    worldContainer,
    uiContainer,
    fireworks,
    background,
    onModeChange: (mode) => planningMode.setActive(mode === 'sequential'),
    onToggleRecording: () => void toggleRecording(),
    onSnapshot: () => void takeSnapshot(),
    // "مدفع" moved from the header into ShapesPanel — see its own doc-comment.
    onInputModeChange: (mode) => {
      inputMode = mode;
    },
    // "العرض التلقائي" is a third continuous-launch screen, alongside
    // متتابع/جماعي — the exit button (below) governs it too now, not just
    // the planned-show flow.
    onAutoShowChange: (enabled) => {
      autoShowActive = enabled;
      updateExitButtonVisibility();
    },
  });

  // The header is fully visible the instant the mood opens — see the module
  // doc-comment above for why there's no setup gate anymore. Every
  // interactive Pixi control in this app now plays its own flash+click
  // feedback directly (see HeaderBar.wireTap(), PlanningIconColumn's tap
  // handler, etc.) — the old DOM-delegated attachTactileFeedback() has been
  // removed entirely, since PlanningScreen no longer has a DOM root at all
  // for its `button`/`.mzj-tab`/`[data-tactile]` selector to ever match
  // (it had gone silently dead once PlanningIconColumn/PlanningSubpanels/
  // TextComposer all moved off DOM, and was found + fixed in this pass).
  const idleFade = new IdleFadeController([header.container]);

  // --- Exit button: the show's one deliberate, always-visible way back ---
  //
  // Once "ابدأ العرض" hides the header/icon column, the only thing that
  // could ever bring UI back was an incidental touch reviving the header via
  // IdleFadeController's own reveal-on-activity behaviour — not a real,
  // discoverable exit, and even then the header's "الرئيسية" button leaves
  // the whole mood rather than just ending the show. This is a dedicated
  // control instead: visible only while a show is actually running,
  // deliberately *not* one of idleFade's targets (unlike the header, it must
  // never depend on activity to become visible again — see beginShow()/
  // endShow() above for exactly when it's shown/hidden), positioned clear of
  // the header row so the two never overlap even if the header happens to be
  // transiently revealed at the same time.
  const EXIT_BUTTON_DIAMETER = 36;
  const EXIT_BUTTON_HIT_SIZE = 44;
  const EXIT_BUTTON_TOP_INSET = 76;
  const EXIT_BUTTON_RIGHT_INSET = 10;

  const exitButton = new Container();
  exitButton.label = 'إنهاء العرض والعودة';
  exitButton.eventMode = 'static';
  exitButton.cursor = 'pointer';
  exitButton.visible = false;
  exitButton.hitArea = new Rectangle(
    -EXIT_BUTTON_HIT_SIZE / 2,
    -EXIT_BUTTON_HIT_SIZE / 2,
    EXIT_BUTTON_HIT_SIZE,
    EXIT_BUTTON_HIT_SIZE,
  );

  const exitButtonBg = new Graphics();
  exitButtonBg
    .circle(0, 0, EXIT_BUTTON_DIAMETER / 2)
    .fill({ color: 0x0f172a, alpha: 0.45 })
    .stroke({ width: 1, color: 0xffffff, alpha: 0.16 });
  exitButtonBg.filters = [new BackdropBlurFilter({ strength: 6, quality: 4 })];
  exitButton.addChild(exitButtonBg);

  const exitButtonIcon = new Sprite();
  exitButtonIcon.anchor.set(0.5);
  exitButtonIcon.tint = 0xe5e7eb;
  exitButtonIcon.width = 16;
  exitButtonIcon.height = 16;
  exitButton.addChild(exitButtonIcon);
  void iconTexture('x', 40, '#ffffff').then((texture) => {
    exitButtonIcon.texture = texture;
  });

  uiContainer.addChild(exitButton);

  function layoutExitButton(): void {
    exitButton.position.set(
      app.screen.width - EXIT_BUTTON_RIGHT_INSET - EXIT_BUTTON_DIAMETER / 2,
      EXIT_BUTTON_TOP_INSET + EXIT_BUTTON_DIAMETER / 2,
    );
  }
  layoutExitButton();
  app.renderer.on('resize', () => layoutExitButton());

  // Same stopPropagation-on-pointerdown-too discipline as HeaderBar.wireTap()
  // — the stage's own tap-to-fire listener is bound to raw pointerdown, which
  // fires before pointertap is ever recognized, so pointerdown alone can
  // launch a rocket underneath this button without it too.
  exitButton.on('pointerdown', (event) => event.stopPropagation());
  exitButton.on('pointertap', (event) => {
    event.stopPropagation();
    audio.playUiClick();
    endShow();
  });

  /**
   * Visible whenever *any* continuous-launch screen is active — the planned
   * show (متتابع/جماعي via "ابدأ العرض", full immersion, UI hidden) or
   * "العرض التلقائي" (continuous random launching, setup screen stays
   * visible/usable while it runs). Different states, same need: a single,
   * reliable, always-in-the-same-place way back to a fully idle screen
   * instead of hunting for whichever toggle started it.
   */
  function updateExitButtonVisibility(): void {
    exitButton.visible = showStarted || autoShowActive;
  }

  handle = {
    show(): void {
      container.style.display = 'block';
      header.container.visible = true;
      app.ticker.start();
    },
    hide(): void {
      container.style.display = 'none';
      header.container.visible = false;
      app.ticker.stop();
    },
  };

  handle.show();
  return handle;
}
