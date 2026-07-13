import { Texture } from 'pixi.js';
import { standaloneIconSvg, type IconName } from './icons';

const cache = new Map<string, Promise<Texture>>();

/**
 * Rasterizes one of the app's hand-authored line icons (the exact same
 * artwork `icon()` renders as inline HTML SVG) into a PixiJS Texture, so it
 * can be drawn as a Sprite inside a canvas-only panel — see ShapesPanel.
 * Cached per (name, size, color) since the same icon is reused every time a
 * panel is rebuilt.
 */
export function iconTexture(name: IconName, size: number, color = '#ffffff'): Promise<Texture> {
  const key = `${name}:${size}:${color}`;
  let entry = cache.get(key);
  if (!entry) {
    const markup = standaloneIconSvg(name, size, color);
    const uri = `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
    entry = new Promise<Texture>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(Texture.from(image));
      image.onerror = () => reject(new Error(`failed to rasterize icon "${name}"`));
      image.src = uri;
    });
    cache.set(key, entry);
  }
  return entry;
}
