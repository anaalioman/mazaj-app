/**
 * Inline replacements for the old `#app, #home-screen { ... }` and
 * `#app canvas, #home-screen canvas { ... }` rules in style.css — the same
 * declarations, applied as `element.style.*` assignments instead of a
 * stylesheet selector. Position/size math for `<canvas>` and its host div
 * has no Pixi/canvas-internal equivalent (this is document layout, not
 * scene content), so it stays real inline style, just no longer in a .css
 * file.
 */
export function styleFixedFullscreenHost(el: HTMLElement): void {
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.cursor = 'crosshair';
}

export function styleFullscreenCanvas(canvas: HTMLCanvasElement): void {
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}
