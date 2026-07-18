import { Assets, Texture, type Spritesheet } from 'pixi.js';
import type { IconName } from './icons';

const ATLAS_URL = 'icons-atlas.json';
let sheetPromise: Promise<Spritesheet> | null = null;

function loadSheet(): Promise<Spritesheet> {
  if (!sheetPromise) sheetPromise = Assets.load<Spritesheet>(ATLAS_URL);
  return sheetPromise;
}

/**
 * Returns one of the app's hand-authored line icons (baked once, in white,
 * into public/icons-atlas.png/.json by scripts/generateIconAtlas.mjs — see
 * that script and icons.ts) as a PixiJS Texture cut from that shared atlas.
 *
 * `size`/`color` are kept in the signature so every existing call site
 * (ShapesPanel, PlanningIconColumn, HeaderBar, TextComposer, fireworksMood,
 * HomeScreen) needs no change, but neither affects the returned texture any
 * more: the atlas is pre-baked once at a fixed resolution in white, and
 * every caller already rescales via sprite.width/height and retints via
 * sprite.tint regardless of the source texture's own size/color.
 */
export async function iconTexture(name: IconName, _size: number, _color = '#ffffff'): Promise<Texture> {
  const sheet = await loadSheet();
  const texture = sheet.textures[name];
  if (!texture) throw new Error(`icon "${name}" missing from icons-atlas`);
  return texture;
}
