import { Application } from 'pixi.js';
import { FireworksSystem } from '../fireworks/FireworksSystem';
import { TextReveal } from '../effects/TextReveal';
import { MortarField } from '../effects/MortarField';
import { ScreenFlash } from '../effects/ScreenFlash';
import { ShockwaveManager } from '../effects/Shockwave';
import { ScreenShakeManager } from '../effects/ScreenShake';
import { AudioManager } from '../audio/AudioManager';
import { RecordingManager, downloadBlob } from '../recording/RecordingManager';
import { BackgroundLayer } from '../background';
import { HeaderBar, type InputMode } from '../ui/HeaderBar';
import { IdleFadeController } from '../ui/IdleFade';
import { attachTactileFeedback } from '../ui/tactile';
import { withTimeout } from '../utils/withTimeout';
import { PlanningMode } from '../ui/PlanningMode';
import { PlanningScreen } from '../ui/PlanningScreen';

export interface FireworksMoodHandle {
  show(): void;
  hide(): void;
}

// Royal black: a deep, rich near-black backdrop for the fireworks stage.
const ROYAL_BLACK = '#040406';

/**
 * Boots the fireworks mood inside `container` (expects the #app/.hint markup
 * already in place, see index.html) and wires the "back to home" callback
 * into the header. Called once, lazily, the first time the player picks this
 * mood from the home screen; subsequent visits just call `show()`/`hide()`.
 *
 * The full control panel (patterns, environment, messages, lab) is visible
 * the instant the mood opens — there's no separate setup gate to get past.
 * Image/phrase/pattern selection all happen from within that panel; tap-to-
 * fire is live immediately. "ابدأ العرض" in the header is a deliberate,
 * one-time action that plays the opening phrase reveal and switches into
 * the fully-immersive (UI-hidden) viewing mode.
 */
export async function startFireworksMood(container: HTMLElement, onBackToHome: () => void): Promise<FireworksMoodHandle> {
  const appContainer = container.querySelector<HTMLDivElement>('#app')!;
  const hint = container.querySelector<HTMLDivElement>('.hint')!;
  hint.classList.remove('hidden');

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

  const background = new BackgroundLayer(app);

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
  const explosionFlash = new ScreenFlash(app);
  const shockwave = new ShockwaveManager(app);
  const screenShake = new ScreenShakeManager(app);

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

  const textReveal = new TextReveal(app);
  const recording = new RecordingManager(app.canvas as HTMLCanvasElement, audio.getRecordingStream());

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
  // the reachable planning area is always the full screen. PlanningMode
  // itself is currently dormant (see its own doc-comment) pending its
  // rewrite on top of the planning screen.
  function getVisibleRange(): { top: number; height: number } {
    return { top: 0, height: app.screen.height };
  }

  const planningMode = new PlanningMode({ app, onLaunchPin: fireAt, getVisibleRange });

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.renderer.on('resize', () => {
    app.stage.hitArea = app.screen;
  });

  // Free Tap fires exactly where the player touches; Mortar Field snaps the
  // launch x to whichever tube is closest, for a more "grounded" show. Tap-
  // to-fire is live the instant the mood opens — no separate "start" gate.
  // While Planning Mode is active, taps place/remove numbered pins instead
  // of firing immediately — see the dedicated "launch plan" button.
  app.stage.on('pointerdown', (event) => {
    const { x, y } = event.global;
    const launchX = inputMode === 'mortar' ? mortarField.getNearestX(x) : x;

    if (planningMode.isActive) {
      planningMode.handleTap(launchX, y);
      return;
    }

    fireAt(launchX, y);
  });

  app.ticker.add((ticker) => {
    fireworks.update(ticker.deltaTime);
    mortarField.update(ticker.deltaTime);
    textReveal.update(ticker.deltaTime);
    explosionFlash.update(ticker.deltaMS / 1000);
    shockwave.update(ticker.deltaMS / 1000);
    screenShake.update(ticker.deltaMS / 1000);
  });

  // "ابدأ العرض" is a one-time, deliberate action (not a setup gate): it
  // plays the opening phrase reveal, then switches into full immersion.
  // Pressing it again afterwards is a no-op — the reveal isn't designed to
  // replay (its smoke/text sprites aren't cleared on a second call). The
  // greeting text field was removed along with the "الرسائل" tab (superseded
  // by the "T" placeholder in the new planning screen), so this is fixed
  // for now until that text-entry flow is rebuilt.
  const DEFAULT_GREETING = 'مبروك';
  let showStarted = false;

  function beginShow(): void {
    if (showStarted) return;
    showStarted = true;

    // The planning screen must never still be up once the show begins,
    // whether or not the player closed it themselves first.
    planningScreen.hide();

    audio.playReveal();
    void withTimeout(textReveal.reveal(DEFAULT_GREETING), 5000, 'TextReveal.reveal').catch((error) => {
      console.error('تعذّر عرض عبارة الافتتاح (سيستمر العرض على أي حال):', error);
    });

    // Full-immersion: go straight to the completely-hidden state instead of
    // leaving the UI visible for the first idle timeout. The player brings
    // it back at any moment with the existing tap/move-to-reveal behaviour
    // (IdleFadeController), same as it works everywhere else.
    idleFade.hideNow();
  }

  // --- Camera-style flash + snapshot/recording ---

  const flash = document.createElement('div');
  flash.id = 'mzj-flash';
  flash.className = 'mzj-hidden';
  document.body.appendChild(flash);

  function flashScreen(): void {
    flash.classList.remove('mzj-hidden');
    flash.style.transition = 'none';
    flash.style.opacity = '1';
    void flash.offsetWidth; // force reflow so the fade-out transition below actually animates
    flash.style.transition = 'opacity 400ms ease-out';
    flash.style.opacity = '0';

    window.setTimeout(() => {
      flash.classList.add('mzj-hidden');
      flash.style.transition = '';
    }, 420);
  }

  async function takeSnapshot(): Promise<void> {
    flashScreen();
    try {
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

  async function toggleRecording(): Promise<void> {
    if (recording.isRecording) {
      try {
        const blob = await recording.stop();
        downloadBlob(blob, `mazaj-fireworks-${Date.now()}.webm`);
      } catch (error) {
        console.error('تعذّر إنهاء التسجيل:', error);
      } finally {
        header.setRecordingState(false);
      }
      return;
    }

    try {
      recording.start();
      header.setRecordingState(true);
    } catch (error) {
      console.error('تعذّر بدء التسجيل:', error);
    }
  }

  // Assigned below; referenced here only inside a callback that can't run
  // until after this function has finished setting everything up.
  let handle!: FireworksMoodHandle;

  const header = new HeaderBar({
    app,
    audio,
    onModeChange: (mode) => {
      inputMode = mode;
    },
    onStartShow: () => beginShow(),
    onSnapshot: () => void takeSnapshot(),
    onToggleRecording: () => void toggleRecording(),
    onBackToHome: () => {
      handle.hide();
      onBackToHome();
    },
    onOpenPlanningScreen: (mode) => planningScreen.show(mode),
  });

  // Shown after picking a launch mode (or the header's plan button). Every
  // control that has a real, already-built function behind it is wired
  // directly here to `fireworks`/`background` — see PlanningScreen's own
  // doc-comment for exactly which icons are still inert and why.
  const planningScreen = new PlanningScreen({ fireworks, background, onSnapshot: () => void takeSnapshot() });

  // The header is fully visible the instant the mood opens — see the module
  // doc-comment above for why there's no setup gate anymore.
  const idleFade = new IdleFadeController([header.root]);
  attachTactileFeedback(header.root, audio);
  attachTactileFeedback(planningScreen.root, audio);

  handle = {
    show(): void {
      container.classList.remove('mzj-hidden');
      header.root.classList.remove('mzj-hidden');
      app.ticker.start();
    },
    hide(): void {
      container.classList.add('mzj-hidden');
      header.root.classList.add('mzj-hidden');
      app.ticker.stop();
    },
  };

  handle.show();
  return handle;
}
