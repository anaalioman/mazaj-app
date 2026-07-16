import { Application, Container } from 'pixi.js';
import { applyDocumentShellStyles } from './dom/documentShell';
import { loadTajawalFonts } from './dom/loadFonts';
import { styleFullscreenCanvas } from './dom/shellStyles';
import { HomeScreen, HOME_BACKGROUND, type MoodId } from './home/HomeScreen';
import type { FireworksMoodHandle } from './moods/fireworksMood';
import { initializeMonetization } from './services';

applyDocumentShellStyles();
// Fire-and-forget, same as the old font-display:swap — the UI renders with
// the fallback stack immediately and swaps to Tajawal once it loads.
void loadTajawalFonts();

// Fire-and-forget: no-ops on web/dev, and shouldn't block the home screen
// from rendering while the native SDKs (if present) spin up.
void initializeMonetization();

/**
 * One shared PIXI.Application for the whole app — every "screen" (the home
 * hub, each mood) is a Container added to `app.stage`, shown/hidden via
 * `.visible` instead of ever getting its own Application/canvas/DOM host.
 * There is exactly one `<canvas>` in the whole document, appended once
 * below; screen switching is Container visibility, not DOM routing.
 *
 * A mood's own code/asset bundle still only downloads the first time it's
 * actually picked (see enterFireworks()'s dynamic `import()` below) — that
 * lazy-loading is a JS bundler concern, orthogonal to (and unaffected by)
 * collapsing the *render* side down to one Application; it's the reason a
 * product with 6 more moods on its roadmap (see home/HomeScreen.ts's own
 * MOODS list) doesn't pay for code it hasn't shown the player yet.
 */
const app = new Application();

async function boot(): Promise<void> {
  await app.init({
    resizeTo: window,
    background: HOME_BACKGROUND,
    backgroundAlpha: 1,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
    // Needed so canvas.captureStream() (the fireworks mood's video
    // recording) sees fresh frames instead of an already-cleared WebGL
    // buffer — harmless for every other screen sharing this Application.
    preserveDrawingBuffer: true,
  });

  document.body.appendChild(app.canvas);
  styleFullscreenCanvas(app.canvas);

  const homeLayer = new Container();
  const fireworksLayer = new Container();
  fireworksLayer.visible = false;
  app.stage.addChild(homeLayer);
  app.stage.addChild(fireworksLayer);

  let fireworksHandle: FireworksMoodHandle | null = null;
  // Tracks an in-flight load so a second tap while the first is still
  // awaiting its dynamic import + setup (real, common on a touchscreen)
  // re-attaches to the same load instead of booting a second, fully-
  // duplicate mood instance (duplicate header, dashboard, submit listener,
  // ...) inside the same fireworksLayer.
  let fireworksLoading: Promise<FireworksMoodHandle> | null = null;

  function goHome(): void {
    fireworksHandle?.hide();
    fireworksLayer.visible = false;
    homeLayer.visible = true;
    app.renderer.background.color = HOME_BACKGROUND;
  }

  async function enterFireworks(): Promise<void> {
    homeLayer.visible = false;
    fireworksLayer.visible = true;

    if (fireworksHandle) {
      app.renderer.background.color = (await import('./moods/fireworksMood')).ROYAL_BLACK;
      fireworksHandle.show();
      return;
    }

    if (!fireworksLoading) {
      fireworksLoading = import('./moods/fireworksMood').then(({ startFireworksMood, ROYAL_BLACK }) => {
        app.renderer.background.color = ROYAL_BLACK;
        return startFireworksMood(app, fireworksLayer, goHome);
      });
    }

    fireworksHandle = await fireworksLoading;
  }

  HomeScreen.create(app, homeLayer, {
    onSelect: (mood: MoodId) => {
      if (mood === 'fireworks') void enterFireworks();
    },
  });
}

void boot();
