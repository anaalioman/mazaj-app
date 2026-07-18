import { Assets, Texture, type Spritesheet } from 'pixi.js';
import type { IconName } from './icons';

const ATLAS_URL = 'icons-atlas.json';
let sheetPromise: Promise<Spritesheet> | null = null;
let resolvedSheet: Spritesheet | null = null;

function loadSheet(): Promise<Spritesheet> {
  if (!sheetPromise) {
    sheetPromise = Assets.load<Spritesheet>(ATLAS_URL).then((sheet) => {
      resolvedSheet = sheet;
      return sheet;
    });
  }
  return sheetPromise;
}

/**
 * Returns one of the app's hand-authored line icons (baked once, in white,
 * into public/icons-atlas.png/.json by scripts/generateIconAtlas.mjs — see
 * that script and icons.ts) as a PixiJS Texture cut from that shared atlas.
 *
 * `size`/`color` are kept in the signature so every existing call site
 * (ShapesPanel, HeaderBar, TextComposer, fireworksMood, HomeScreen) needs no
 * change, but neither affects the returned texture any more: the atlas is
 * pre-baked once at a fixed resolution in white, and every caller already
 * rescales via sprite.width/height and retints via sprite.tint regardless of
 * the source texture's own size/color.
 */
export async function iconTexture(name: IconName, _size: number, _color = '#ffffff'): Promise<Texture> {
  const sheet = await loadSheet();
  const texture = sheet.textures[name];
  if (!texture) throw new Error(`icon "${name}" missing from icons-atlas`);
  return texture;
}

/**
 * Ensures the atlas is loaded, for callers that need synchronous access via
 * `atlasTexture()` afterward (see PlanningIconColumn, which is only ever
 * constructed after `startFireworksMood()` awaits this once up front — no
 * `.then()`/fade-in per row needed once the atlas is already in memory).
 */
export async function preloadIconAtlas(): Promise<void> {
  await loadSheet();
}

/**
 * Synchronous atlas lookup for any frame name — a plain icon (`IconName`)
 * or one of PlanningIconColumn's own `planning*`-prefixed frames (glow-baked
 * icon variants, the two plate looks, the flash halo — see
 * scripts/generateIconAtlas.mjs). Throws if `preloadIconAtlas()` hasn't
 * resolved yet or the name isn't in the atlas — a real, loud contract
 * failure rather than a silently missing texture.
 */
export function atlasTexture(name: string): Texture {
  if (!resolvedSheet) throw new Error('icons-atlas not preloaded — call preloadIconAtlas() first');
  const texture = resolvedSheet.textures[name];
  if (!texture) throw new Error(`"${name}" missing from icons-atlas`);
  return texture;
}
