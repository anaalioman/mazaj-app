import { Application } from 'pixi.js';
import { FireworksSystem } from '../fireworks/FireworksSystem';
import { TextReveal } from '../effects/TextReveal';
import { MortarField } from '../effects/MortarField';
import { GlowFrame } from '../effects/GlowFrame';
import { ScreenFlash } from '../effects/ScreenFlash';
import { ShockwaveManager } from '../effects/Shockwave';
import { ScreenShakeManager } from '../effects/ScreenShake';
import { AudioManager } from '../audio/AudioManager';
import { RecordingManager, downloadBlob } from '../recording/RecordingManager';
import { BackgroundLayer } from '../background';
import { HeaderBar, type InputMode } from '../ui/HeaderBar';
import { BottomDashboard } from '../ui/BottomDashboard';
import { IdleFadeController } from '../ui/IdleFade';
import { attachTactileFeedback } from '../ui/tactile';
import { withTimeout } from '../utils/withTimeout';
import { icon } from '../ui/icons';
import { PlanningMode } from '../ui/PlanningMode';

export interface FireworksMoodHandle {
  show(): void;
  hide(): void;
}

// Royal black: a deep, rich near-black backdrop for the fireworks stage.
const ROYAL_BLACK = '#040406';

/**
 * Boots the fireworks mood inside `container` (expects the #app/#setup-overlay/.hint
 * markup already in place, see index.html) and wires the "back to home" callback
 * into the header. Called once, lazily, the first time the player picks this mood
 * from the home screen; subsequent visits just call `show()`/`hide()`.
 */
export async function startFireworksMood(container: HTMLElement, onBackToHome: () => void): Promise<FireworksMoodHandle> {
  const appContainer = container.querySelector<HTMLDivElement>('#app')!;
  const setupOverlay = container.querySelector<HTMLFormElement>('#setup-overlay')!;
  const imageInput = container.querySelector<HTMLInputElement>('#image-input')!;
  const phraseInput = container.querySelector<HTMLInputElement>('#phrase-input')!;
  const hint = container.querySelector<HTMLDivElement>('.hint')!;
  const startShowBtn = container.querySelector<HTMLButtonElement>('#start-show-btn')!;
  startShowBtn.insertAdjacentHTML('afterbegin', icon('play', 17));

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
  const glowFrame = new GlowFrame(app);
  const recording = new RecordingManager(app.canvas as HTMLCanvasElement, audio.getRecordingStream());

  let fireworksEnabled = false;

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

  const planningMode = new PlanningMode({ app, onLaunchPin: fireAt });

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.renderer.on('resize', () => {
    app.stage.hitArea = app.screen;
  });

  // Free Tap fires exactly where the player touches; Mortar Field snaps the
  // launch x to whichever tube is closest, for a more "grounded" show. While
  // Planning Mode is active, taps place/remove numbered pins instead of
  // firing immediately — see the dedicated "launch plan" button.
  app.stage.on('pointerdown', (event) => {
    if (!fireworksEnabled) return;
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

  setupOverlay.addEventListener('submit', (event) => {
    event.preventDefault();
    void startShow();
  });

  async function startShow(): Promise<void> {
    setupOverlay.classList.add('hidden');
    hint.classList.remove('hidden');

    // Every step below is best-effort: a stuck or failing API (audio, image
    // decoding, the text-reveal animation) must never prevent the fireworks
    // show itself from starting — that's the one thing this screen exists
    // for, so it runs unconditionally in `finally`.
    try {
      await audio.unlock();
      if (audio.hasMissingSounds()) {
        console.info('أضف ملفات الصوت في public/audio/ لتفعيل المؤثرات الصوتية (راجع public/audio/README.md).');
      }

      const file = imageInput.files?.[0];
      if (file) {
        await withTimeout(background.setImage(file), 5000, 'BackgroundLayer.setImage');
      }

      audio.playReveal();
      await withTimeout(textReveal.reveal(phraseInput.value), 5000, 'TextReveal.reveal');
    } catch (error) {
      console.error('تعذّرت إحدى خطوات بدء العرض (سيبدأ العرض على أي حال):', error);
    } finally {
      fireworksEnabled = true;
      fireworks.setAutoLaunch(true);
      // The header/dashboard only make sense once the show is actually
      // running — showing them earlier, on top of the setup form, is what
      // caused the two screens to visually collide.
      header.root.classList.remove('mzj-await-start');
      dashboard.root.classList.remove('mzj-await-start');
      // Full-immersion: go straight to the completely-hidden state instead
      // of leaving the UI visible for the first idle timeout. The player
      // brings it back at any moment with the existing tap/move-to-reveal
      // behaviour (IdleFadeController), same as it works everywhere else.
      idleFade.hideNow();
    }
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
    onSnapshot: () => void takeSnapshot(),
    onToggleRecording: () => void toggleRecording(),
    onBackToHome: () => {
      handle.hide();
      onBackToHome();
    },
  });

  const dashboard = new BottomDashboard({ fireworks, background, glowFrame, planningMode });

  // Hidden until startShow() finishes setup — see the `finally` block above.
  header.root.classList.add('mzj-await-start');
  dashboard.root.classList.add('mzj-await-start');

  const idleFade = new IdleFadeController([header.root, dashboard.root]);
  attachTactileFeedback(header.root, audio);
  attachTactileFeedback(dashboard.root, audio);

  handle = {
    show(): void {
      container.classList.remove('mzj-hidden');
      header.root.classList.remove('mzj-hidden');
      dashboard.root.classList.remove('mzj-hidden');
      app.ticker.start();
    },
    hide(): void {
      container.classList.add('mzj-hidden');
      header.root.classList.add('mzj-hidden');
      dashboard.root.classList.add('mzj-hidden');
      app.ticker.stop();
    },
  };

  handle.show();
  return handle;
}
