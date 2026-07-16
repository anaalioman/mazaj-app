/**
 * Inline replacement for the old `#app canvas { ... }` rule in style.css —
 * the same declarations, applied as `element.style.*` assignments directly
 * to the one shared `<canvas>` instead of a stylesheet selector or a
 * separate host `<div>`. Position/size math for the element the browser
 * gives WebGL/WebGPU access through has no Pixi/canvas-internal equivalent
 * (this is document layout, not scene content — Pixi renders *inside* this
 * element, it cannot size or position the element itself), so it stays real
 * inline style, just no longer in a .css file and no longer wrapping the
 * canvas in an extra host element.
 */
export function styleFullscreenCanvas(canvas: HTMLCanvasElement): void {
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
}
