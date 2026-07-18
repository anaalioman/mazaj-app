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
    // 'low-power' (not 'high-performance'): this app never needs a discrete/
    // max-power GPU to hit a smooth 60fps, and 'high-performance' explicitly
    // tells the browser to favor peak clocks over thermals — a direct
    // contributor to a phone heating up during normal play.
    powerPreference: 'low-power',
    // Needed so canvas.captureStream() (the fireworks mood's video
    // recording) sees fresh frames instead of an already-cleared WebGL
    // buffer — harmless for every other screen sharing this Application.
    preserveDrawingBuffer: true,
  });

  // Many phones run their display at 90Hz/120Hz; Pixi's ticker syncs to
  // requestAnimationFrame by default, so an uncapped app would render
  // 1.5x-2x as many frames per second as a 60fps show ever needs — pure
  // extra GPU heat with no visible smoothness gain over 60fps for this
  // content (particle bursts, glow, UI transitions).
  app.ticker.maxFPS = 60;

  document.body.appendChild(app.canvas);
  styleFullscreenCanvas(app.canvas);

  const homeLayer = new Container();
  const fireworksLayer = new Container();
  fireworksLayer.visible = false;
  app.stage.addChild(homeLayer);
  app.stage.addChild(fireworksLayer);

  // Every global drag/long-press gesture in the app (PixiSlider, the text
  // composer's resize/rotate/scroll handles, PlanningMode's long-press)
  // registers its pointermove/pointerup listeners on app.stage directly —
  // Pixi's event bubbling only reaches a stage-level listener at all once
  // the stage itself is a valid interactive hit target, not merely one of
  // its descendants. moodLayer's own hitArea (see fireworksMood.ts) still
  // independently gates the mood's tap-to-fire listener while hidden — this
  // is the complementary, app-wide piece that makes stage-level bubbling
  // work in the first place.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.renderer.on('resize', () => {
    app.stage.hitArea = app.screen;
  });

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
