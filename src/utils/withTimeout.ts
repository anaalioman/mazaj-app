/**
 * Races a promise against a timeout so a stuck native API (seen on some
 * Android WebView builds — e.g. AudioContext.resume() never settling) can
 * never block the caller forever. The original promise keeps running in the
 * background; this only stops *waiting* on it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
