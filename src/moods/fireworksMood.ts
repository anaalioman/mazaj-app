import { Application, Circle, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture, type Ticker } from 'pixi.js';
import { iconTexture, preloadIconAtlas } from '../ui/svgIconTexture';
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
import { canSaveToGallery, saveSnapshotToGallery } from '../media/GallerySaver';
import { tickerSetTimeout, type TickerTimerHandle } from '../utils/tickerTimers';
import { createOffscreenCanvas, triggerDownload } from '../dom/shadowServices';
import { trackSwipeOrTap } from '../utils/swipeGesture';

export interface FireworksMoodHandle {
  show(): void;
  hide(): void;
}

// Royal black: a deep, rich near-black backdrop for the fireworks stage.
export const ROYAL_BLACK = '#040406';

/**
 * Boots the fireworks mood's whole scene as a child of `moodLayer` — a
 * Container main.ts already added to the single shared `app.stage`, toggled
 * visible/hidden instead of ever getting its own Application/canvas/DOM host
 * (see main.ts's own doc comment for why: one Application, one canvas, two
 * screens as Containers). Wires the "back to home" callback into the header.
 * Called once, lazily, the first time the player picks this mood from the
 * home screen; subsequent visits just call `show()`/`hide()`.
 *
 * Tap-to-fire is live the instant the mood opens — there's no setup gate.
 * The header's pin-icon button opens the full-screen planning layout (see
 * PlanningScreen) for the mass/sequential planned-launch flow. "ابدأ العرض"
 * is a deliberate, one-time action: it fires whatever plan is active (see
 * `launchPlannedShow()`), plays the opening phrase reveal, and switches into
 * the fully-immersive (UI-hidden) viewing mode, all in one call.
 */
export async function startFireworksMood(app: Application, moodLayer: Container, onBackToHome: () => void): Promise<FireworksMoodHandle> {
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
  moodLayer.addChild(worldContainer);
  // `isRenderGroup: true` — uiContainer's own subtree (header, icon column,
  // every panel, the text-composer toolbar) gets its own cached set of GPU
  // render instructions, independent of worldContainer's constantly-changing
  // particle counts. Without it, every UI element (mostly static between
  // frames) would be re-batched alongside the fireworks simulation on every
  // single frame; with it, Pixi only rebuilds uiContainer's batches when
  // something inside uiContainer itself actually changes.
  const uiContainer = new Container({ isRenderGroup: true });
  moodLayer.addChild(uiContainer);
  // Lets HeaderBar's own `container.zIndex = 9999` actually take effect —
  // PixiJS only sorts a container's children by zIndex when the *parent*
  // has `sortableChildren` enabled. Without this, PlanningScreen's later-
  // added panels (SideDockPanel's ShapesPanel/ColorPickerPanel, which can
  // land at y=8 on a short screen) paint over the header's own button row
  // by plain insertion order, since header.container is added here first.
  uiContainer.sortableChildren = true;

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
  const recordCanvas = createOffscreenCanvas(app.screen.width * app.renderer.resolution, app.screen.height * app.renderer.resolution);
  const recordCtx = recordCanvas.getContext('2d')!;
  // A fixed viewport rect, not the default tight bounding box around
  // worldContainer's current contents — particles/background constantly
  // move, so an auto-fit frame would resize/shift every single extracted
  // frame instead of producing a stable video.
  const worldExtractFrame = new Rectangle(0, 0, app.screen.width, app.screen.height);
  app.renderer.on('resize', () => {
    recordCanvas.width = app.screen.width * app.renderer.resolution;
    recordCanvas.height = app.screen.height * app.renderer.resolution;
    // Mutated in place instead of a fresh `new Rectangle(...)` per resize —
    // same zero-allocation-in-resize-path convention as FireworksSystem's
    // own filterArea fix.
    worldExtractFrame.width = app.screen.width;
    worldExtractFrame.height = app.screen.height;
  });

  const background = new BackgroundLayer(app, worldContainer);

  const audio = new AudioManager(app);
  // Fire-and-forget: unlocking must never block the panel from appearing,
  // and it's still within the same user-initiated call chain that opened
  // this mood (the browser's autoplay-gesture leniency covers this).
  void audio
    .unlock()
    .then(() => {
      if (audio.hasMissingSounds()) {
        console.info('أضف ملفات الصوت في public/audio/ لتفعيل المؤثرات الصوتية (راجع public/audio/README.md).');
      }
    })
    .catch((error: unknown) => {
      console.error('تعذّر تهيئة الصوت:', error);
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

  const textReveal = new TextReveal(app, worldContainer, fireworks);
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
      tickerSetTimeout(app.ticker, stopSizzle, 5000);
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
    // Deferred closures, not direct calls — `planningScreen` isn't assigned
    // until later in this function (same TDZ constraint as getActiveShape
    // above), but neither ever runs until a real pointer event does.
    isChromeHidden: () => planningScreen.isChromeHidden(),
    onSwipeReveal: () => planningScreen.revealChrome(),
  });
  uiContainer.addChild(planningMode.layer);

  // Bound to `moodLayer`, not `app.stage` — app.stage is now shared with
  // every other screen (see main.ts), and a container with `visible: false`
  // is skipped by Pixi's hit-testing entirely, children and self alike. That
  // alone is what stops this from ever firing while the player is looking at
  // the home screen or any future mood: no manual "is this mood active" flag
  // needed, just the same visible check Pixi already does for rendering.
  moodLayer.eventMode = 'static';
  moodLayer.hitArea = app.screen;
  app.renderer.on('resize', () => {
    moodLayer.hitArea = app.screen;
  });

  // Free Tap fires exactly where the player touches; Mortar Field snaps the
  // launch x to whichever tube is closest, for a more "grounded" show. Tap-
  // to-fire is live the instant the mood opens — no separate "start" gate —
  // right up until either "ابدأ العرض" actually fires the planned show
  // (showStarted) or the player has started actively building one
  // (planningMode.isActive the moment sequential mode is chosen;
  // planningScreen.hasMassSelection() the moment a mass shape is queued):
  // from then on every other input is locked so a stray tap can't fire an
  // unrelated free rocket instead of respecting the plan being built. The
  // exit button is the one deliberate exception, wired on its own listener
  // with its own stopPropagation, independent of this handler entirely.
  // While sequential planning is active, PlanningMode's own listeners (see
  // above) handle every tap instead — this handler steps aside entirely.
  moodLayer.on('pointerdown', (event) => {
    if (showStarted || planningMode.isActive || planningScreen.hasMassSelection()) return;
    const { x, y } = event.global;
    // While the planning screen's chrome is slid away for shot placement, a
    // leftward drag past the threshold means "bring the panels back", not
    // "fire here" — see PlanningScreen.isChromeHidden()/revealChrome() and
    // swipeGesture.ts's own doc comment on why this has to live inside this
    // existing handler rather than a separate, later-registered listener.
    if (planningScreen.isChromeHidden()) {
      trackSwipeOrTap(
        app,
        event,
        () => planningScreen.revealChrome(),
        () => {
          const launchX = inputMode === 'mortar' ? mortarField.getNearestX(x) : x;
          fireAt(launchX, y);
        },
      );
      return;
    }
    const launchX = inputMode === 'mortar' ? mortarField.getNearestX(x) : x;
    fireAt(launchX, y);
  });

  // Guarded on moodLayer.visible — app.ticker is now shared and always
  // running (see main.ts), so this mood's own per-frame simulation must
  // explicitly stand down while hidden instead of relying on the ticker
  // itself being paused (that would also freeze every other screen's Ticker-
  // driven timers, see utils/tickerTimers.ts).
  app.ticker.add((ticker) => {
    if (!moodLayer.visible) return;
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
  // No canned fallback — a show started without ever touching the composer
  // reveals nothing (TextReveal.reveal()'s own empty-string guard resolves
  // immediately with no text created), rather than a default greeting.
  const FALLBACK_GREETING = '';
  let showStarted = false;
  // Mirrors PlanningScreen's own "العرض التلقائي" state — the exit button
  // must stay visible for this continuous-launch screen too, not just the
  // planned-show flow (see updateExitButtonVisibility() below).
  let autoShowActive = false;
  // Hard safety cap on "العرض التلقائي": continuous auto-launching has no
  // natural end (unlike a planned mass/sequential show, which finishes on
  // its own), so left running indefinitely it's real, sustained GPU/CPU load
  // with no player-driven reason to stop — a genuine device-heat concern on
  // a phone. A real device-temperature API doesn't exist for a Capacitor
  // WebView without writing a native plugin, so this is a fixed, conservative
  // ceiling instead: auto-stops exactly like the exit button would, cleanly,
  // via the same endShow() path.
  const AUTO_SHOW_MAX_MS = 60_000;
  let autoShowStopTimer: TickerTimerHandle | undefined;
  // Mirrors PlanningScreen.hasMassSelection() — tracked locally rather than
  // queried from planningScreen directly, since onModeChange (passed into
  // PlanningScreen's own constructor below) calls updateExitButtonVisibility()
  // synchronously as part of that very construction, before the `const
  // planningScreen = new PlanningScreen(...)` assignment has finished.
  let massSelectionActive = false;
  // Mirrors TextComposer's own open()/commit() state (via PlanningScreen's
  // onTextComposingChange) — see updateExitButtonVisibility() below for why
  // this specifically suppresses the exit button rather than just adding it
  // to the "show it" list: a confirmed, reproduced pixel-for-pixel overlap
  // between exitButton and the composer's own back arrow, both independently
  // positioned "just clear of the header" without either one knowing about
  // the other. Same construction-order safety as massSelectionActive above.
  let textComposing = false;

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

    // "العرض التلقائي" only actually starts firing here, at "ابدأ العرض" —
    // arming it (PlanningScreen.setAutoShow()) never touches the engine
    // itself. Independent of whichever mass/sequential plan launchPlannedShow()
    // just fired above (both can run together if the player armed both).
    if (planningScreen.isAutoShowArmed()) {
      fireworks.setAutoLaunch(true);
      autoShowStopTimer = tickerSetTimeout(app.ticker, () => endShow(), AUTO_SHOW_MAX_MS);
    }

    // The planning screen must never still be up once the show begins,
    // whether or not the player closed it themselves first.
    planningScreen.hide();

    // Uses whatever the player set up via the "T" icon (text, effect,
    // position, scale); falls back to the plain default only if they never
    // touched it at all this session — see TextComposer.consumeForReveal().
    const textConfig = planningScreen.consumeTextRevealConfig();
    const revealPhrase = textConfig?.text ?? FALLBACK_GREETING;
    audio.playReveal();
    // CharacterReveal launches one real rocket per letter, staggered — the
    // reveal's own total duration scales with the phrase's length (unlike
    // the old single dissolve-effect reveal, which took a fixed ~2-3s
    // regardless of text length), so the timeout has to scale with it too,
    // not stay a flat guess.
    void withTimeout(
      textConfig ? textReveal.reveal(textConfig.text, textConfig) : textReveal.reveal(FALLBACK_GREETING),
      revealPhrase.length * 900 + 7000,
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
    updateShutterButtonVisibility();
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
    // A show that had actually started (fired via "ابدأ العرض") keeps its
    // mass selection afterward, so the same plan can be repeated — only a
    // *pending*, never-fired selection gets abandoned below.
    const wasShowRunning = showStarted;
    fireworks.clearActive();
    // clearActive() only clears already-in-flight rockets/particles — the
    // engine's own continuous auto-launch loop (see FireworksSystem.update())
    // keeps scheduling new ones otherwise. Also cancels this show's own
    // AUTO_SHOW_MAX_MS safety timer (see beginShow()) so a manual exit
    // doesn't leave a stale timer that could call endShow() again later.
    fireworks.setAutoLaunch(false);
    autoShowStopTimer?.cancel();
    autoShowStopTimer = undefined;
    // A sequential show's staggered per-pin Ticker timers (see PlanningMode's
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
    if (!wasShowRunning) planningScreen.clearPendingSelection();
    showStarted = false;
    updateExitButtonVisibility();
    updateShutterButtonVisibility();
  }

  /**
   * Full teardown for leaving this mood entirely — called from handle.hide()
   * below (main.ts's goHome(), or the header's own "الرئيسية" button), never
   * from inside the mood itself. A strict superset of endShow()'s own reset:
   * safe to call whether or not any show was ever running (every operation
   * here is already a no-op on empty/idle state), and — unlike endShow(),
   * which deliberately keeps a *completed* show's mass selection around so
   * the same plan can be repeated without leaving the mood — always
   * abandons any pending plan, since there's no "repeat" concept once the
   * player has actually left. Recording, if any, is discarded rather than
   * downloaded (see stopRecording()'s own `discard` param doc comment) so
   * simply glancing at the home screen never triggers a surprise download
   * of an incomplete clip. Left running behind the home screen otherwise:
   * the continuous auto-launch loop, its safety timer, PlanningMode's
   * staggered per-pin timers, the MediaRecorder/its audio stream, an
   * in-flight snapshot capture (its lift-up animation, and — where still
   * possible — its save; see cancelActiveSnapshot's own doc comment for
   * exactly what this can and can't actually stop), and a still-fading
   * camera flash — exactly the set this function stops.
   */
  function resetForExit(): void {
    fireworks.clearActive();
    fireworks.setAutoLaunch(false);
    autoShowStopTimer?.cancel();
    autoShowStopTimer = undefined;
    planningMode.cancelPending();
    if (recording.isRecording) void stopRecording(true);
    cancelActiveSnapshot?.();
    cancelActiveFlash?.();
    snapshotErrorHideTimer?.cancel();
    snapshotErrorHideTimer = undefined;
    snapshotErrorText.alpha = 0;
    snapshotErrorText.text = '';
    textReveal.clear();
    header.resetStartShowButton();
    idleFade.disarmAndShow();
    planningScreen.show(planningScreen.getMode());
    planningScreen.disableAutoShow();
    planningScreen.clearPendingSelection();
    showStarted = false;
    updateExitButtonVisibility();
    updateShutterButtonVisibility();
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

  // Cancel handle for whatever flash is currently fading, if any — set by
  // flashScreen() below, cleared once that flash either finishes on its own
  // or is cancelled. resetForExit() (leaving the mood mid-flash) calls this
  // directly so a flash left fading behind the home screen doesn't keep its
  // app.ticker callback alive for no reason.
  let cancelActiveFlash: (() => void) | null = null;

  function flashScreen(): void {
    // A new capture's flash must not race a still-fading previous one (the
    // shutter button is disabled for the duration of a capture — see
    // setShutterButtonEnabled() — so this only matters for the one case
    // that guard doesn't cover: resetForExit() re-arming the mood for a
    // fresh visit while an old flash was still fading).
    cancelActiveFlash?.();

    cameraFlash.alpha = 1;
    let elapsedMs = 0;
    const step = (t: Ticker): void => {
      elapsedMs += t.deltaMS;
      const progress = Math.min(1, elapsedMs / FLASH_FADE_MS);
      const eased = 1 - (1 - progress) ** 3;
      cameraFlash.alpha = 1 - eased;
      if (progress >= 1) {
        app.ticker.remove(step);
        cancelActiveFlash = null;
      }
    };
    app.ticker.add(step);

    cancelActiveFlash = () => {
      app.ticker.remove(step);
      cameraFlash.alpha = 0;
      cancelActiveFlash = null;
    };
  }

  // A snapshot failure used to be visible only in console.error — invisible
  // in a shipped APK without USB debugging attached, so a real-device field
  // test had no way to report anything more specific than "it doesn't show
  // up". This surfaces the actual error text on screen for a few seconds
  // instead, directly below the shutter button so it reads as belonging to
  // that action.
  const SNAPSHOT_ERROR_VISIBLE_MS = 4000;
  const snapshotErrorText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Tajawal, system-ui, sans-serif',
      fontSize: 12,
      fontWeight: '600',
      fill: 0xff6b6b,
      align: 'center',
      wordWrap: true,
    }),
  });
  snapshotErrorText.anchor.set(0.5, 0);
  snapshotErrorText.alpha = 0;
  snapshotErrorText.eventMode = 'none';
  uiContainer.addChild(snapshotErrorText);
  let snapshotErrorHideTimer: TickerTimerHandle | undefined;

  function layoutSnapshotErrorText(): void {
    snapshotErrorText.style.wordWrapWidth = Math.min(320, app.screen.width * 0.8);
    snapshotErrorText.position.set(app.screen.width / 2, app.screen.height - 24);
  }
  layoutSnapshotErrorText();
  app.renderer.on('resize', () => layoutSnapshotErrorText());

  function showSnapshotError(message: string): void {
    snapshotErrorText.text = `تعذّر حفظ اللقطة: ${message}`;
    snapshotErrorText.alpha = 1;
    snapshotErrorHideTimer?.cancel();
    snapshotErrorHideTimer = tickerSetTimeout(app.ticker, () => {
      snapshotErrorText.alpha = 0;
    }, SNAPSHOT_ERROR_VISIBLE_MS);
  }

  // --- "Lift-up" thumbnail: the photo-flies-to-the-gallery confirmation ---
  //
  // Pure Pixi — a Sprite built from the same extracted Texture takeSnapshot()
  // saves, never a DOM <img>. Lives in uiContainer, added at the moment of
  // capture (after every persistent HUD element was already added during
  // setup), so it paints on top of everything, including the fireworks,
  // without needing the usual "re-append to force top z-order" dance those
  // persistent elements need.
  const LIFT_THUMB_WIDTH_RATIO = 0.38;
  const LIFT_HOLD_MS = 180;
  const LIFT_MOVE_MS = 550;
  const LIFT_RISE_DISTANCE = 160;
  const LIFT_END_SCALE = 0.62;

  /**
   * Wraps the one Texture takeSnapshot() extracts per capture so its GPU
   * disposal is a single, idempotent call rather than a comment-enforced
   * "only destroy this exactly once, from exactly one place" convention —
   * a second (or third) `destroySafely()` call from anywhere is always a
   * safe no-op instead of a double-free, structurally, not by discipline.
   */
  class SnapshotTexture {
    readonly texture: Texture;
    private destroyed = false;
    constructor(texture: Texture) {
      this.texture = texture;
    }
    destroySafely(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.texture.destroy(true);
    }
  }

  /**
   * Plays the rise animation only — ownership of the extracted Texture
   * itself (and when it's safe to destroy) stays with takeSnapshot()'s own
   * SnapshotTexture wrapper; this function never calls destroySafely(),
   * only resolves `done` once its own frame/thumb sprites are fully torn
   * down (normal finish) or once `cancel()` is called (early stop).
   * Destroying the shared texture here (as this used to) raced against
   * takeSnapshot()'s own concurrent `extract.base64()` read of that same
   * texture — whichever finished first could tear it out from under the
   * other. See takeSnapshot()'s own Promise.allSettled() for the actual fix.
   *
   * `cancel()` — used by takeSnapshot() when resetForExit() (leaving the
   * mood mid-snapshot) cancels the in-flight capture — tears the frame/thumb
   * down immediately, same as a normal finish, and resolves `done` right
   * away instead of waiting out the rest of the animation. `cancel()` itself
   * never triggers the shutter sound: if cancellation happens before the
   * tick that would have played it (elapsedMs still under LIFT_HOLD_MS),
   * this capture's shutter sound simply never plays; if the sound had
   * already played on an earlier tick, cancelling now cannot undo that — it
   * already happened.
   *
   * The whole setup below (frame/thumb creation, adding them to
   * uiContainer, registering the ticker callback) runs inside a try/catch:
   * if any step throws partway through, everything already created up to
   * that point is torn back down (removed from uiContainer, destroyed, its
   * ticker callback removed if it was already registered) before the error
   * is rethrown — so a partial failure here never leaves an orphaned
   * Graphics/Sprite on screen or a dangling app.ticker callback.
   */
  function playSnapshotLiftUp(texture: Texture): { done: Promise<void>; cancel: () => void } {
    const frameWidth = Math.min(app.screen.width, app.screen.height) * LIFT_THUMB_WIDTH_RATIO;
    const frameHeight = (texture.height / texture.width) * frameWidth;
    const centerX = app.screen.width / 2;
    const centerY = app.screen.height / 2;

    let frame: Graphics | undefined;
    let thumb: Sprite | undefined;
    let registeredTick: ((ticker: Ticker) => void) | undefined;

    try {
      // In `uiContainer`, not `app.stage` directly — every other piece of
      // this mood's own floating HUD (exit/shutter buttons, snapshot error
      // text) lives there too; nothing belonging to this screen should be
      // parented straight onto the app-wide stage.
      frame = new Graphics()
        .roundRect(-frameWidth / 2 - 5, -frameHeight / 2 - 5, frameWidth + 10, frameHeight + 10, 10)
        .fill({ color: 0xffffff })
        .stroke({ width: 1, color: 0x000000, alpha: 0.12 });
      frame.eventMode = 'none';
      frame.position.set(centerX, centerY);
      uiContainer.addChild(frame);

      thumb = new Sprite(texture);
      thumb.eventMode = 'none';
      thumb.anchor.set(0.5);
      thumb.width = frameWidth;
      thumb.height = frameHeight;
      thumb.position.set(centerX, centerY);
      // The .width/.height setters above already computed the scale needed
      // to fit the extracted (much larger) texture into the thumbnail size —
      // the animation below must multiply against *this* base, not overwrite
      // it, or the sprite would snap back to its full, unscaled texture size
      // the instant the rise animation's own scale factor is first applied.
      const thumbBaseScaleX = thumb.scale.x;
      const thumbBaseScaleY = thumb.scale.y;
      uiContainer.addChild(thumb);

      // Local, non-optional aliases — once execution reaches this point both
      // are guaranteed created and added, so the ticker-driven code below
      // (which can run many frames later) references these instead of the
      // outer `frame`/`thumb` variables, which stay typed as possibly
      // `undefined` for the catch block above.
      const frameNode = frame;
      const thumbNode = thumb;

      // Fires the instant the rise motion actually begins (not at tap-time —
      // see takeSnapshot(), which deliberately does *not* play this sound
      // itself anymore), so the click is heard in sync with the photo
      // starting to lift, not with the (silent, camera-flash-only) capture
      // moment a beat earlier.
      let shutterSoundPlayed = false;
      let elapsedMs = 0;
      let settled = false;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      // Each step is independent — wrapped in its own try/catch so a failure
      // in one (e.g. removeChild() on a node already detached some other way)
      // can never block the rest: the ticker callback must come off, and
      // both frameNode and thumbNode must each still get their own
      // detach-then-destroy attempt regardless of what happened to the
      // others. `node.parent` is checked before removeChild() rather than
      // calling it unconditionally — removeChild() on a node this container
      // doesn't actually own is not this function's failure to make. Every
      // caught error is logged, never swallowed silently.
      function teardown(): void {
        try {
          app.ticker.remove(tick);
        } catch (error) {
          console.error('تعذّر إزالة مستمع حركة رفع اللقطة:', error);
        }
        try {
          if (frameNode.parent) frameNode.parent.removeChild(frameNode);
        } catch (error) {
          console.error('تعذّر فصل إطار اللقطة عن حاويته:', error);
        }
        try {
          frameNode.destroy();
        } catch (error) {
          console.error('تعذّر تدمير إطار اللقطة:', error);
        }
        try {
          if (thumbNode.parent) thumbNode.parent.removeChild(thumbNode);
        } catch (error) {
          console.error('تعذّر فصل الصورة المصغّرة عن حاويتها:', error);
        }
        try {
          // Sprite only — `texture` itself is a shared resource
          // takeSnapshot() still owns via its own SnapshotTexture, disposed
          // only once both this animation and the save operation have
          // settled.
          thumbNode.destroy({ texture: false, textureSource: false });
        } catch (error) {
          console.error('تعذّر تدمير الصورة المصغّرة:', error);
        }
      }

      // Sole path to ending this animation, whether by normal completion,
      // cancel(), or a caught error from inside tick() — `settled` guards it
      // so cancel() racing a same-tick natural finish (or a second cancel()
      // call) can never teardown or resolveDone() twice. teardown() itself
      // never throws (every step inside it is independently caught), so
      // resolveDone() below is always reached regardless of what teardown()
      // did or didn't manage to clean up — otherwise `done` would hang
      // forever and takeSnapshot()'s `await Promise.allSettled([liftDone,
      // saveDone])` would never reach its own finally that destroys
      // snapshotTexture, leaving snapshotInProgress/the shutter button stuck
      // disabled too.
      function finishOnce(error?: unknown): void {
        if (settled) return;
        settled = true;
        if (error !== undefined) console.error('تعذّر تشغيل حركة رفع اللقطة:', error);
        teardown();
        resolveDone();
      }

      // Driven by app.ticker — the same 60fps-synced loop every other moving
      // piece in this file (fireworks, mortars, text reveal, shockwave,
      // screen shake) already runs on, rather than a separate raw
      // requestAnimationFrame call. `ticker.deltaMS` accounts for real frame
      // spacing the same way those updates do. The whole body runs inside a
      // try/catch: a synchronous throw from audio.playCameraShutter(), any of
      // the position/alpha/scale writes below, or teardown() on natural
      // finish must never leave this ticker callback registered or `done`
      // unresolved — see finishOnce() above for why that would otherwise wedge
      // takeSnapshot() itself.
      function tick(ticker: Ticker): void {
        try {
          elapsedMs += ticker.deltaMS;
          if (elapsedMs < LIFT_HOLD_MS) return;
          if (!shutterSoundPlayed) {
            shutterSoundPlayed = true;
            audio.playCameraShutter();
          }
          const t = Math.min(1, (elapsedMs - LIFT_HOLD_MS) / LIFT_MOVE_MS);
          const eased = 1 - (1 - t) ** 3;
          const y = centerY - LIFT_RISE_DISTANCE * eased;
          const alpha = 1 - eased;
          const scale = 1 - (1 - LIFT_END_SCALE) * eased;
          frameNode.position.y = y;
          frameNode.alpha = alpha;
          frameNode.scale.set(scale);
          thumbNode.position.y = y;
          thumbNode.alpha = alpha;
          thumbNode.scale.set(thumbBaseScaleX * scale, thumbBaseScaleY * scale);
          if (t < 1) return;

          finishOnce();
        } catch (error) {
          finishOnce(error);
        }
      }
      app.ticker.add(tick);
      registeredTick = tick;

      function cancel(): void {
        finishOnce();
      }

      return { done, cancel };
    } catch (error) {
      // Same independent-step principle as teardown() above: whatever
      // partly got created before the throw, each piece of it gets its own
      // detach-then-destroy attempt regardless of whether an earlier one
      // failed — a failed removeChild(thumb) must not skip thumb.destroy()
      // or frame's own cleanup. The original construction error is what's
      // rethrown at the end either way; these are cleanup-of-cleanup
      // failures, logged, never allowed to replace or swallow it.
      if (registeredTick) {
        try {
          app.ticker.remove(registeredTick);
        } catch (removeError) {
          console.error('تعذّر إزالة مستمع الحركة بعد فشل إنشاء لقطة الرفع:', removeError);
        }
      }
      if (thumb) {
        try {
          if (thumb.parent) thumb.parent.removeChild(thumb);
        } catch (removeError) {
          console.error('تعذّر فصل الصورة المصغّرة بعد فشل إنشاء لقطة الرفع:', removeError);
        }
        try {
          thumb.destroy({ texture: false, textureSource: false });
        } catch (destroyError) {
          console.error('تعذّر تدمير الصورة المصغّرة بعد فشل إنشاء لقطة الرفع:', destroyError);
        }
      }
      if (frame) {
        try {
          if (frame.parent) frame.parent.removeChild(frame);
        } catch (removeError) {
          console.error('تعذّر فصل إطار اللقطة بعد فشل إنشاء لقطة الرفع:', removeError);
        }
        try {
          frame.destroy();
        } catch (destroyError) {
          console.error('تعذّر تدمير إطار اللقطة بعد فشل إنشاء لقطة الرفع:', destroyError);
        }
      }
      throw error;
    }
  }

  // --- Snapshot lifecycle: single-flight guard + cancellation on exit ---
  //
  // One capture at a time only — a rapid double-tap on the shutter button
  // used to be able to kick off two concurrent `extract.texture()` calls,
  // each with its own lift-up animation and save, racing each other for no
  // reason. `snapshotInProgress` blocks a second tap outright; the button
  // itself is also visually disabled for the same window (see
  // setShutterButtonEnabled()) so a second tap has a visible reason to do
  // nothing instead of silently failing.
  //
  // Leaving the mood mid-snapshot (resetForExit(), e.g. "الرئيسية") calls
  // `cancelActiveSnapshot()`: it stops the lift-up animation immediately
  // (see playSnapshotLiftUp()'s own cancel()) and marks the capture as
  // cancelled. Neither `extract.base64()` nor `saveSnapshotToGallery()` can
  // actually be aborted mid-flight — neither Pixi's extraction nor
  // GallerySaver expose a real abort — so whichever of those two is already
  // running at the moment of cancellation keeps running to completion in
  // the background exactly as if the player had stayed. What `cancelled`
  // *can* still control is the choice point in between: once
  // `extract.base64()` resolves, saveSnapshotToGallery()/triggerDownload()
  // haven't started yet, so a cancelled capture skips them outright instead
  // of writing a photo for a capture the player already abandoned — see the
  // `if (cancelled) return;` inside takeSnapshot()'s saveDone below. Either
  // way, showSnapshotError() is always suppressed once cancelled, so no
  // stale error toast can surface on a screen the player has since left (or
  // returned to for an unrelated, later capture). This is a genuine,
  // permanent limitation on the two uncancellable calls themselves, not a
  // bug: there is no cancellable primitive to call instead of them.
  let snapshotInProgress = false;
  let cancelActiveSnapshot: (() => void) | null = null;

  function setShutterButtonEnabled(enabled: boolean): void {
    shutterButton.eventMode = enabled ? 'static' : 'none';
    shutterButton.alpha = enabled ? 1 : 0.5;
  }

  async function takeSnapshot(): Promise<void> {
    if (snapshotInProgress) return;
    snapshotInProgress = true;
    setShutterButtonEnabled(false);

    let cancelled = false;

    try {
      // Extracted once as a Texture (not base64 directly) so the lift-up
      // thumbnail and the actually-saved photo are guaranteed to be the
      // exact same frame — fireworks animate every tick, so extracting
      // twice could otherwise show the player a thumbnail that doesn't
      // match what landed in their gallery.
      const snapshotTexture = new SnapshotTexture(
        app.renderer.extract.texture({
          target: worldContainer,
          resolution: Math.min(app.renderer.resolution * 1.5, 3),
        }),
      );

      // Ownership of snapshotTexture starts the instant extract.texture()
      // above actually succeeds — every step from here through the final
      // await must therefore run inside this one try/finally, not just the
      // Promise.allSettled() call at the end of it: a throw in flashScreen(),
      // playSnapshotLiftUp(), the one-tick wait, or building saveDone itself
      // used to skip destroySafely() entirely and leak the GPU texture,
      // since the old finally only wrapped the very last await. Starting the
      // try right after a successful extraction instead closes that gap.
      try {
        flashScreen();
        // The shutter sound itself fires from inside playSnapshotLiftUp(),
        // synced to the exact frame the thumbnail starts rising — see its
        // own doc comment. Runs concurrently with the save below;
        // snapshotTexture is only ever destroyed once *both* have genuinely
        // finished (success, failure, or cancellation) — never from inside
        // either one individually, which used to race (see
        // playSnapshotLiftUp()'s own doc comment for the premature-
        // destruction bug this replaced).
        const lift = playSnapshotLiftUp(snapshotTexture.texture);
        cancelActiveSnapshot = () => {
          cancelled = true;
          lift.cancel();
        };
        const liftDone = lift.done;

        // `extract.base64()` reads pixels back from the GPU via a canvas
        // readback. While debugging in this sandbox's headless/software-WebGL
        // browser, new display objects sometimes stopped rendering after this
        // call ran — results were inconsistent across repeated identical runs,
        // more consistent with a flaky sandbox test environment than a
        // deterministic engine bug, but unresolved either way. Waiting for one
        // real rendered frame here before calling base64() is a cheap,
        // harmless precaution regardless of the root cause; this whole
        // sequence still needs verification on a real device build. Goes
        // through app.ticker like every other frame-wait in this file, rather
        // than a raw requestAnimationFrame call.
        await new Promise<void>((resolve) => { tickerSetTimeout(app.ticker, resolve, 0); });

        // Checked here, immediately after the frame wait and before
        // extract.base64() is ever called: cancelling during that wait (e.g.
        // resetForExit() firing while this tick is still pending) must not
        // let a GPU readback start behind a screen that's already gone back
        // to Home. Once base64() itself starts it's real and uncancellable
        // (see below) — this is the one point where skipping it entirely is
        // still possible. Resolves immediately rather than doing any work,
        // so Promise.allSettled() below never has anything left pending.
        const saveDone = cancelled ? Promise.resolve() : (async () => {
          try {
            // Targets worldContainer exclusively — see this file's own
            // container-tree doc comment. Every UI control (including the
            // flash and the lift-up thumbnail itself) lives in the sibling
            // uiContainer and is structurally invisible to this capture.
            const dataUrl = await app.renderer.extract.base64(snapshotTexture.texture);
            // Unlike the extraction just above (already ran to completion,
            // uncancellable) and saveSnapshotToGallery()/triggerDownload()
            // just below (once started, also uncancellable — see
            // cancelActiveSnapshot's own doc comment), starting the save at
            // all is still a choice at this exact point: if resetForExit()
            // cancelled this capture while extract.base64() was in flight,
            // there is no reason to write anything anywhere once it resolves.
            if (cancelled) return;
            // "لقطة" ≠ "تنزيل": on the real app, this must land straight in
            // the device's own photo gallery, never a file-download prompt —
            // see GallerySaver's own doc comment. The `<a download>` browser
            // pattern only runs as a fallback where there's no OS gallery to
            // write into at all (this file previewed in a plain browser tab,
            // e.g. during this project's own sandboxed development/testing).
            // Once started, this itself runs to completion even if `cancelled`
            // becomes true while it's in flight — see cancelActiveSnapshot's
            // own doc comment above for why that's a real, permanent
            // limitation and not a bug.
            if (canSaveToGallery()) {
              await saveSnapshotToGallery(dataUrl);
            } else {
              triggerDownload(dataUrl, `mazaj-snapshot-${Date.now()}.png`);
            }
          } catch (error) {
            // console.error alone is invisible in a shipped APK without USB
            // debugging attached — a field test that fails silently here
            // gives no way to tell "it failed" from "it worked but I didn't
            // check the gallery yet". showSnapshotError() surfaces the real
            // error message on screen so a real-device test actually reports
            // something actionable back, instead of just "it doesn't show
            // up" — but only while the player is still actually looking at
            // this capture; a cancelled capture (mood already left, or a
            // fresh capture since started) must never show a stale error.
            console.error('تعذّر التقاط اللقطة:', error);
            if (!cancelled) showSnapshotError(error instanceof Error ? error.message : String(error));
          }
        })();

        // Neither operation's own outcome should block or skip the other.
        await Promise.allSettled([liftDone, saveDone]);
      } finally {
        // The one and only place that disposes snapshotTexture — now
        // guaranteed to run whether the block above finishes normally,
        // throws at any point, or is short-circuited by cancellation.
        snapshotTexture.destroySafely();
      }
    } catch (error) {
      // Covers everything in the try block above that isn't already owned by
      // saveDone's own catch — extract.texture(), flashScreen(),
      // playSnapshotLiftUp(), and the one-tick wait before saveDone is even
      // created. saveDone's internal errors never reach here: Promise.allSettled()
      // never rejects, so a failure inside saveDone is fully handled by its
      // own catch (console.error + conditional showSnapshotError()) and stops
      // there — this block never sees or re-reports it.
      console.error('تعذّر التقاط اللقطة:', error);
      if (!cancelled) showSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      snapshotInProgress = false;
      cancelActiveSnapshot = null;
      setShutterButtonEnabled(true);
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

  /**
   * `discard` is used only by resetForExit() below (leaving this mood
   * entirely, e.g. "الرئيسية") — RecordingManager has no cancel-without-save
   * primitive (its own stop() always resolves with the recorded Blob), so
   * the only way to stop the recorder without also forcing an unwanted
   * download of a recording the player never asked to finish is to still
   * call stop() but simply not act on the Blob it resolves with. Every
   * other call site (endShow(), toggleRecording()) keeps the existing
   * save-and-download behavior.
   */
  async function stopRecording(discard = false): Promise<void> {
    if (!recording.isRecording) return;
    try {
      const blob = await recording.stop();
      if (!discard) downloadBlob(blob, `mazaj-fireworks-${Date.now()}.webm`);
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

  // --- Exit button: the show's one deliberate, always-visible way back ---
  //
  // Built *before* PlanningScreen below, deliberately: PlanningScreen's own
  // constructor calls onModeChange synchronously as part of its own setup
  // (see its show()/applyMode()), and onModeChange calls
  // updateExitButtonVisibility() — which reads exitButton itself. Declaring
  // exitButton after planningScreen crashed with a real "before
  // initialization" error the very first time sequential mode was touched,
  // since that synchronous call landed mid-construction, before `const
  // exitButton = ...` had even run.
  //
  // Once "ابدأ العرض" hides the header/icon column, the only thing that
  // could ever bring UI back was an incidental touch reviving the header via
  // IdleFadeController's own reveal-on-activity behaviour — not a real,
  // discoverable exit, and even then the header's "الرئيسية" button leaves
  // the whole mood rather than just ending the show. This is a dedicated
  // control instead: visible only while some launch state is active (see
  // updateExitButtonVisibility() below), deliberately *not* one of
  // idleFade's targets (unlike the header, it must never depend on activity
  // to become visible again), positioned clear of the header row so the two
  // never overlap even if the header happens to be transiently revealed at
  // the same time.
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
  exitButton.addChild(exitButtonBg);

  const exitButtonIcon = new Sprite();
  exitButtonIcon.anchor.set(0.5);
  exitButtonIcon.tint = 0xe5e7eb;
  exitButtonIcon.width = 16;
  exitButtonIcon.height = 16;
  exitButton.addChild(exitButtonIcon);
  void iconTexture('x', 40, '#ffffff')
    .then((texture) => {
      exitButtonIcon.texture = texture;
    })
    .catch((error: unknown) => {
      console.error('تعذّر تحميل أيقونة زر الخروج:', error);
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
   * Visible whenever *any* launch state is active — the planned show
   * (متتابع/جماعي via "ابدأ العرض", full immersion, UI hidden),
   * "العرض التلقائي" (continuous random launching, setup screen stays
   * visible/usable while it runs), sequential mode simply being chosen
   * (planningMode.isActive, armed before any pin even exists — free-tap
   * already can't do anything while it's on), or a pending 'mass' selection
   * (a shape queued but "ابدأ العرض" not pressed yet — free-tap is locked
   * for that too, see the stage pointerdown handler below). Different
   * states, same need: a single, reliable, always-in-the-same-place way
   * back to a fully idle screen instead of hunting for whichever toggle/
   * selection started it. Reads only local flags/planningMode, never
   * planningScreen directly — see massSelectionActive's own doc comment for
   * why that matters here specifically.
   *
   * `!textComposing` overrides every one of those — confirmed live (a
   * screenshot with the two circles' own glyphs literally superimposed)
   * that composing text while any other launch state is *also* active (most
   * directly: sequential mode armed, then the player opens the T icon) sits
   * exitButton and the composer's own back-arrow button on almost exactly
   * the same 34-36px circle, ~8px apart center-to-center — both
   * independently positioned "just clear of the header," neither aware the
   * other could ever be visible at the same time. The composer's own arrow
   * already serves the identical "one reliable way back" role for exactly
   * as long as it's on screen, so suppressing exitButton for that same
   * window removes the collision at its source instead of shrinking either
   * button or nudging their fixed positions apart.
   */
  function updateExitButtonVisibility(): void {
    exitButton.visible = !textComposing && (showStarted || autoShowActive || massSelectionActive || planningMode.isActive);
  }

  // --- Floating shutter button: capture stays reachable during the show ---
  //
  // "لقطة" in the icon column becomes completely unreachable the instant
  // "ابدأ العرض" hides it — this is the show's own dedicated capture
  // trigger instead, visible only for exactly as long as showStarted is
  // true (set in beginShow()/endShow()/updateShutterButtonVisibility()
  // below), same lifecycle as the exit button but scoped tighter: العرض
  // التلقائي and a pending mass selection still leave the icon column (and
  // its own "لقطة" row) reachable, so this one stays hidden for those.
  // Genuinely circular hitArea via Pixi's Circle shape (not a squared-off
  // Rectangle standing in for one), sized well past the 44px minimum to
  // read as the primary action it is — matches real camera-app shutter
  // buttons in both look and touch-target size.
  const SHUTTER_BUTTON_RADIUS = 32;
  const SHUTTER_BUTTON_BOTTOM_INSET = 40;

  const shutterButton = new Container();
  shutterButton.label = 'التقاط لقطة';
  shutterButton.eventMode = 'static';
  shutterButton.cursor = 'pointer';
  shutterButton.visible = false;
  shutterButton.hitArea = new Circle(0, 0, SHUTTER_BUTTON_RADIUS);

  const shutterRing = new Graphics()
    .circle(0, 0, SHUTTER_BUTTON_RADIUS)
    .fill({ color: 0xffffff, alpha: 0.9 })
    .circle(0, 0, SHUTTER_BUTTON_RADIUS - 5)
    .cut();
  shutterButton.addChild(shutterRing);

  const shutterCore = new Graphics().circle(0, 0, SHUTTER_BUTTON_RADIUS - 8).fill({ color: 0xe11d2f });
  shutterButton.addChild(shutterCore);

  uiContainer.addChild(shutterButton);

  function layoutShutterButton(): void {
    shutterButton.position.set(app.screen.width / 2, app.screen.height - SHUTTER_BUTTON_BOTTOM_INSET - SHUTTER_BUTTON_RADIUS);
  }
  layoutShutterButton();
  app.renderer.on('resize', () => layoutShutterButton());

  // No audio.playUiClick() here — takeSnapshot() plays its own dedicated
  // camera-shutter sound (playCameraShutter()), and stacking the generic
  // click tone underneath it would muddy exactly the "professional shutter
  // sound" this button exists to trigger. Same stopPropagation-on-
  // pointerdown discipline as every other Pixi button here — see
  // exitButton's own wiring above for why pointerdown needs it too, not
  // just pointertap.
  shutterButton.on('pointerdown', (event) => event.stopPropagation());
  shutterButton.on('pointertap', (event) => {
    event.stopPropagation();
    void takeSnapshot();
  });

  function updateShutterButtonVisibility(): void {
    // "العرض التلقائي" no longer fires anything the instant it's toggled —
    // it only arms (see PlanningScreen.setAutoShow()'s own doc comment), and
    // actually starts firing exactly when showStarted becomes true (via
    // beginShow()) same as every other launch style, so showStarted alone
    // already covers it correctly here. "توليد عشوائي هجين" still doesn't
    // belong here either way: setRandomMode() only flags which burst
    // patterns get used by whatever launches next — it never calls
    // launch() itself, so toggling it alone produces no scene worth
    // capturing yet.
    shutterButton.visible = showStarted;
  }

  // PlanningIconColumn (built inside PlanningScreen below) needs every icon
  // texture synchronously — no per-row `.then()`/fade-in — so the atlas must
  // already be resolved before it's constructed. Every other icon consumer
  // in this file (HeaderBar, TextComposer, ShapesPanel) still uses the async
  // iconTexture() and doesn't need this, but awaiting it once up front here
  // is harmless for them too since Assets.load() is idempotent.
  await preloadIconAtlas();

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
    onModeChange: (mode) => {
      planningMode.setActive(mode === 'sequential');
      updateExitButtonVisibility();
    },
    onToggleRecording: () => void toggleRecording(),
    // "مدفع" moved from the header into ShapesPanel — see its own doc-comment.
    onInputModeChange: (mode) => {
      inputMode = mode;
      // The tubes themselves only belong on screen while Mortar Mode is
      // actually selected — see MortarField's own doc comment.
      mortarField.setVisible(mode === 'mortar');
    },
    // "العرض التلقائي" is a third launch style, alongside متتابع/جماعي —
    // this only fires when the player *arms* it (picks the icon), same
    // gating as picking a mass/sequential mode: nothing actually launches,
    // nothing collapses, until "ابدأ العرض" is pressed (see beginShow()'s
    // own isAutoShowArmed() branch below). autoShowActive here just tracks
    // "armed" for the exit button, so the player has a way to cancel an
    // armed-but-not-yet-started selection, exactly like massSelectionActive.
    onAutoShowChange: (enabled) => {
      autoShowActive = enabled;
      updateExitButtonVisibility();
      updateShutterButtonVisibility();
    },
    // A mass shape was queued/unqueued — re-check whether the exit button
    // should show (see massSelectionActive's own doc comment).
    onMassSelectionChange: (hasSelection) => {
      massSelectionActive = hasSelection;
      updateExitButtonVisibility();
    },
    // Text composing opened/closed — see textComposing's own doc comment.
    onTextComposingChange: (composing) => {
      textComposing = composing;
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
  const idleFade = new IdleFadeController([header.container], app.ticker);

  // Pixi paints/hit-tests a container's children in add order (last added =
  // topmost) — exitButton/shutterButton/snapshotErrorText had to be
  // *constructed* before header/planningScreen above (see exitButton's own
  // doc comment on the TDZ crash that forced that), which left them painted
  // *underneath* the icon column added afterward. Re-adding an already-added
  // child moves it to the end instead of duplicating it (documented Pixi
  // behavior), which is exactly what's needed here: this is the single
  // place that deliberately guarantees the show's whole floating HUD — exit
  // button, shutter button, and its own error text — paints on top of every
  // other uiContainer child, verified rather than assumed (a real tap test
  // once caught exitButton's taps landing on "إضاءة الخلفية" instead,
  // before this exact fix was applied to it).
  uiContainer.addChild(exitButton);
  uiContainer.addChild(shutterButton);
  uiContainer.addChild(snapshotErrorText);

  // moodLayer's own visible/hitArea toggling is main.ts's job (it owns every
  // screen's show/hide, see its own doc comment) — show() only resets the
  // header's own visibility, independent of idleFade's fade state, exactly
  // as a fresh re-entry to the mood should look; hide() additionally runs
  // the full resetForExit() teardown (see its own doc comment) before
  // that, so nothing keeps running behind the home screen.
  handle = {
    show(): void {
      header.container.visible = true;
    },
    hide(): void {
      // Leaving this mood entirely (main.ts's goHome(), or the header's own
      // "الرئيسية") must never leave anything running behind the home
      // screen — see resetForExit()'s own doc comment for exactly what it
      // stops and why it's safe to call unconditionally, including when
      // nothing was ever running.
      resetForExit();
      header.container.visible = false;
    },
  };

  return handle;
}
