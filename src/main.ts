import './fonts.css';
import './style.css';
import './ui/mazajUI.css';
import './home/homeScreen.css';
import { HomeScreen, type MoodId } from './home/HomeScreen';
import type { FireworksMoodHandle } from './moods/fireworksMood';
import { initializeMonetization } from './services';

// Fire-and-forget: no-ops on web/dev, and shouldn't block the home screen
// from rendering while the native SDKs (if present) spin up.
void initializeMonetization();

const homeScreenEl = document.querySelector<HTMLDivElement>('#home-screen')!;
const fireworksContainer = document.querySelector<HTMLDivElement>('#fireworks-mood')!;

let fireworksHandle: FireworksMoodHandle | null = null;

function goHome(): void {
  homeScreenEl.classList.remove('mzj-hidden');
}

async function enterFireworks(): Promise<void> {
  homeScreenEl.classList.add('mzj-hidden');

  if (fireworksHandle) {
    fireworksHandle.show();
    return;
  }

  // Lazy-loaded so the home screen stays light — the fireworks bundle (and
  // every other future mood's bundle) only downloads once actually chosen.
  const { startFireworksMood } = await import('./moods/fireworksMood');
  fireworksHandle = await startFireworksMood(fireworksContainer, goHome);
}

new HomeScreen(homeScreenEl, {
  onSelect: (mood: MoodId) => {
    if (mood === 'fireworks') void enterFireworks();
  },
});
