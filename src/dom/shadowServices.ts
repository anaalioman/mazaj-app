/**
 * Every remaining DOM/browser-API touchpoint in this app that has no
 * Canvas-only equivalent, in one place — nothing here participates in any
 * graphical or UI-design logic (the narrow exception this file exists
 * under): a hidden file-picker trigger, `<video>` elements used purely as
 * texture sources, a browser download trigger, and the Cordova/Capacitor
 * native-bridge readiness signal the in-app-purchase plugin needs. Every
 * caller of these stays a plain UI/business-logic file with zero
 * `document.*`/`.style` of its own — grep this file alone to audit the
 * app's entire DOM footprint outside `dom/documentShell.ts` (the page-level
 * reset, which predates any of this and lives separately for that reason)
 * and `dom/shellStyles.ts` (the one shared canvas's own position/size,
 * which Pixi has no ability to set from inside itself).
 */

/** A file input positioned fully off-screen and invisible — the only way to invoke the OS's native file/photo picker; there is no Canvas API for it. Never rendered, never part of any visible layout. */
export function createHiddenFileInput(accept: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.top = '-9999px';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  for (const type of ['pointerdown', 'click', 'change'] as const) {
    input.addEventListener(type, (event) => event.stopPropagation());
  }
  document.body.appendChild(input);
  return input;
}

/** A looping, muted, autoplaying `<video>` for an uploaded background clip — Pixi has no video-decode capability, so a real element is the only way to get playable frames to hand to a Texture. Never attached to the visible DOM. */
export function createLoopingVideoElement(objectUrl: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = objectUrl;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

/** Same as createLoopingVideoElement, sourced from a live MediaStream (the device camera) instead of a file. */
export function createLiveStreamVideoElement(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

/** A plain 2D canvas used only as a MediaRecorder/compositing surface — never attached to the visible DOM, never styled. */
export function createOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The standard browser "start a file download" trigger — there is no API for this that doesn't involve a real `<a>` element; never attached to the visible DOM. */
export function triggerDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}

/**
 * Resolves once Cordova/Capacitor's native bridge signals it's ready (or
 * `timeoutMs` elapses first, resolving `false`) — the standard event the
 * in-app-purchase plugin needs before its native store object exists. Zero
 * graphical role; a platform-readiness signal, not a UI concern.
 */
export function waitForCordovaDeviceReady(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), timeoutMs);
    document.addEventListener(
      'deviceready',
      () => {
        window.clearTimeout(timeout);
        resolve(true);
      },
      { once: true },
    );
  });
}
