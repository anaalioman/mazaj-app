import type { Ticker } from 'pixi.js';

export interface TickerTimerHandle {
  cancel(): void;
}

/**
 * `setTimeout`, but driven by a PIXI.Ticker's own `deltaMS` instead of the
 * browser's wall-clock timer queue. Firing is frame-synchronized (the
 * callback runs from inside the same tick loop as everything else on
 * screen, never off-frame) and — unlike `window.setTimeout` — the timer
 * naturally stops accumulating whenever the ticker itself is stopped, since
 * a stopped ticker calls no ticks at all.
 */
export function tickerSetTimeout(ticker: Ticker, callback: () => void, delayMs: number): TickerTimerHandle {
  let elapsedMs = 0;
  const tick = (t: Ticker): void => {
    elapsedMs += t.deltaMS;
    if (elapsedMs >= delayMs) {
      ticker.remove(tick);
      callback();
    }
  };
  ticker.add(tick);
  return { cancel: () => ticker.remove(tick) };
}

/** `setInterval`, but driven by a PIXI.Ticker — see tickerSetTimeout. */
export function tickerSetInterval(ticker: Ticker, callback: () => void, intervalMs: number): TickerTimerHandle {
  let elapsedMs = 0;
  const tick = (t: Ticker): void => {
    elapsedMs += t.deltaMS;
    while (elapsedMs >= intervalMs) {
      elapsedMs -= intervalMs;
      callback();
    }
  };
  ticker.add(tick);
  return { cancel: () => ticker.remove(tick) };
}
