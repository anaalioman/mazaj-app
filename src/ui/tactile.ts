import type { AudioManager } from '../audio/AudioManager';

const TACTILE_SELECTOR = 'button, .mzj-tab, [data-tactile]';
const FLASH_MS = 180;

/**
 * Delegated click listener: any button/tab inside `root` gets a brief
 * cyan glow flash and a mechanical click sound on press, without needing
 * to wire each control individually.
 */
export function attachTactileFeedback(root: HTMLElement, audio: AudioManager): void {
  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(TACTILE_SELECTOR);
    if (!target || target.hasAttribute('disabled')) return;

    audio.playUiClick();
    target.classList.add('mzj-flash');
    window.setTimeout(() => target.classList.remove('mzj-flash'), FLASH_MS);
  });
}
