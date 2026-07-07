import './style.css';
import './ui/controlPanel.css';
import { Application } from 'pixi.js';
import { FireworksSystem } from './fireworks/FireworksSystem';
import { TextReveal } from './effects/TextReveal';
import { MortarField } from './effects/MortarField';
import { GlowFrame } from './effects/GlowFrame';
import { AudioManager } from './audio/AudioManager';
import { RecordingManager, downloadBlob } from './recording/RecordingManager';
import { BackgroundLayer } from './background';
import { ControlPanel } from './ui/ControlPanel';

const appContainer = document.querySelector<HTMLDivElement>('#app')!;
const setupOverlay = document.querySelector<HTMLFormElement>('#setup-overlay')!;
const imageInput = document.querySelector<HTMLInputElement>('#image-input')!;
const phraseInput = document.querySelector<HTMLInputElement>('#phrase-input')!;
const recordBtn = document.querySelector<HTMLButtonElement>('#record-btn')!;
const stopRecordBtn = document.querySelector<HTMLButtonElement>('#stop-record-btn')!;
const recordIndicator = document.querySelector<HTMLSpanElement>('#record-indicator')!;
const hint = document.querySelector<HTMLDivElement>('.hint')!;

// Royal black: a deep, rich near-black backdrop for the fireworks stage.
const ROYAL_BLACK = '#040406';

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

const fireworks = new FireworksSystem(app, {
  autoLaunch: false,
  onLaunch: (x) => {
    audio.playLaunch();
    mortarField.fireNear(x);
  },
  onExplode: (x, y) => audio.playExplosion(x, y),
});

const textReveal = new TextReveal(app);
const glowFrame = new GlowFrame(app);
const recording = new RecordingManager(app.canvas as HTMLCanvasElement, audio.getRecordingStream());

new ControlPanel({ app, fireworks, background, glowFrame, recording });

let fireworksEnabled = false;

app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
app.renderer.on('resize', () => {
  app.stage.hitArea = app.screen;
});

// Free-form launch: the shell always fires from wherever the player taps,
// straight up to that same point — no fixed grid or lanes.
app.stage.on('pointerdown', (event) => {
  if (!fireworksEnabled) return;
  const { x, y } = event.global;
  fireworks.launch(x, y);
});

app.ticker.add((ticker) => {
  fireworks.update(ticker.deltaTime);
  mortarField.update(ticker.deltaTime);
  textReveal.update(ticker.deltaTime);
});

setupOverlay.addEventListener('submit', (event) => {
  event.preventDefault();
  void startShow();
});

async function startShow(): Promise<void> {
  setupOverlay.classList.add('hidden');
  hint.classList.remove('hidden');

  await audio.unlock();
  if (audio.hasMissingSounds()) {
    console.info('أضف ملفات الصوت في public/audio/ لتفعيل المؤثرات الصوتية (راجع public/audio/README.md).');
  }

  const file = imageInput.files?.[0];
  if (file) {
    await background.setImage(file);
  }

  audio.playReveal();
  await textReveal.reveal(phraseInput.value);

  fireworksEnabled = true;
  fireworks.setAutoLaunch(true);
}

const canRecord = typeof MediaRecorder !== 'undefined' && typeof app.canvas.captureStream === 'function';
if (!canRecord) {
  recordBtn.disabled = true;
  recordBtn.title = 'تسجيل الفيديو غير مدعوم في هذا المتصفح';
}

recordBtn.addEventListener('click', () => {
  try {
    recording.start();
    recordBtn.disabled = true;
    stopRecordBtn.disabled = false;
    recordIndicator.classList.remove('hidden');
  } catch (error) {
    console.error('تعذّر بدء التسجيل:', error);
  }
});

stopRecordBtn.addEventListener('click', async () => {
  stopRecordBtn.disabled = true;
  try {
    const blob = await recording.stop();
    downloadBlob(blob, `mazaj-fireworks-${Date.now()}.webm`);
  } catch (error) {
    console.error('تعذّر إنهاء التسجيل:', error);
  } finally {
    recordBtn.disabled = false;
    recordIndicator.classList.add('hidden');
  }
});
