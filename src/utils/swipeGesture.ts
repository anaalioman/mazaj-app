import type { Application, FederatedPointerEvent } from 'pixi.js';

/** A leftward drag past this many px counts as a reveal swipe, not a tap. */
const SWIPE_THRESHOLD_PX = 45;
/** Caps how far off-horizontal a drag can be and still count as the reveal swipe — a mostly-vertical drag (e.g. a slider) must never trigger it. */
const SWIPE_MAX_VERTICAL_PX = 60;

/**
 * Distinguishes "the player is placing a shot" (a plain tap: pointerdown then
 * pointerup with negligible movement) from "the player is swiping right-to-
 * left to bring the planning panels back" — for exactly the one window where
 * both are plausible readings of the same gesture (PlanningScreen's chrome
 * hidden while a shape/pin is being placed, see PlanningScreen.isChromeHidden()).
 *
 * Reacts to the swipe the instant the leftward threshold is crossed (not on
 * release) — the standard "reveal follows the finger" feel — and only then
 * suppresses `onTap`; a gesture that never crosses it, however it ends, is a
 * plain tap and fires `onTap` normally on release. Registered on `app.stage`
 * (not the original event's own target) so movement past a small hitArea
 * still tracks correctly, same reasoning as every other stage-level drag in
 * this codebase (PlanningMode, Transformer, PixiSlider).
 */
export function trackSwipeOrTap(
  app: Application,
  startEvent: FederatedPointerEvent,
  onSwipeLeft: () => void,
  onTap: (x: number, y: number) => void,
): void {
  const pointerId = startEvent.pointerId;
  const startX = startEvent.global.x;
  const startY = startEvent.global.y;
  let resolved = false;

  const cleanup = (): void => {
    app.stage.off('pointermove', handleMove);
    app.stage.off('pointerup', handleUp);
    app.stage.off('pointerupoutside', handleUp);
  };

  const handleMove = (event: FederatedPointerEvent): void => {
    if (resolved || event.pointerId !== pointerId) return;
    const dx = event.global.x - startX;
    const dy = event.global.y - startY;
    if (dx <= -SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_MAX_VERTICAL_PX) {
      resolved = true;
      cleanup();
      onSwipeLeft();
    }
  };

  const handleUp = (event: FederatedPointerEvent): void => {
    if (resolved || event.pointerId !== pointerId) return;
    resolved = true;
    cleanup();
    onTap(startX, startY);
  };

  app.stage.on('pointermove', handleMove);
  app.stage.on('pointerup', handleUp);
  app.stage.on('pointerupoutside', handleUp);
}
