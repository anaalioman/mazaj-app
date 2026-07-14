import './fonts.css';
import './style.css';
import { HomeScreen, type MoodId } from './home/HomeScreen';
import type { FireworksMoodHandle } from './moods/fireworksMood';
import { initializeMonetization } from './services';

// Fire-and-forget: no-ops on web/dev, and shouldn't block the home screen
// from rendering while the native SDKs (if present) spin up.
void initializeMonetization();

const homeScreenEl = document.querySelector<HTMLDivElement>('#home-screen')!;
const fireworksContainer = document.querySelector<HTMLDivElement>('#fireworks-mood')!;

let fireworksHandle: FireworksMoodHandle | null = null;
// Tracks an in-flight load so a second tap while the first is still awaiting
// app.init() (real, common on a touchscreen — WebGL setup isn't instant)
// re-attaches to the same load instead of booting a second, fully-duplicate
// mood instance (duplicate canvas, header, dashboard, submit listener, ...).
let fireworksLoading: Promise<FireworksMoodHandle> | null = null;

function goHome(): void {
  homeScreenEl.style.display = 'block';
}

async function enterFireworks(): Promise<void> {
  homeScreenEl.style.display = 'none';

  if (fireworksHandle) {
    fireworksHandle.show();
    return;
  }

  if (!fireworksLoading) {
    // Lazy-loaded so the home screen stays light — the fireworks bundle (and
    // every other future mood's bundle) only downloads once actually chosen.
    fireworksLoading = import('./moods/fireworksMood').then(({ startFireworksMood }) =>
      startFireworksMood(fireworksContainer, goHome),
    );
  }

  fireworksHandle = await fireworksLoading;
}

void HomeScreen.create(homeScreenEl, {
  onSelect: (mood: MoodId) => {
    if (mood === 'fireworks') void enterFireworks();
  },
});
