// Pre-bakes every hand-authored line icon (src/ui/icons.ts) into one real
// pixel spritesheet (public/icons-atlas.png + icons-atlas.json) at build
// time, so the app never rasterizes SVG at runtime — see svgIconTexture.ts,
// which loads this atlas instead of decoding SVG via `new Image()`.
//
// Also bakes a handful of PlanningIconColumn-specific assets into the SAME
// atlas, each under a `planning*`-prefixed name so they can never collide
// with a real icon name from icons.ts:
//   - `planningIcon_<name>`: the 13 icons PlanningIconColumn's rows
//     actually use, re-rendered with a baked soft glow + drop shadow (CSS
//     drop-shadow(), composited once here by a real browser) so that column
//     never needs a live AdvancedBloomFilter/DropShadowFilter per row per
//     frame. These are DELIBERATELY separate frames from the plain
//     `<name>` ones every other consumer (HeaderBar, ShapesPanel,
//     TextComposer, HomeScreen) uses — baking glow into the *shared* plain
//     icons would change their fill-fraction within the frame and regress
//     every other consumer's rendered size, so this column gets its own
//     dedicated, differently-cropped copies instead.
//   - `planningPlateIdle` / `planningPlateActive`: the golden-metallic row
//     plate, baked once in each of its two discrete looks (idle/active) —
//     replaces a live Graphics().clear().circle().fill(FillGradient) redraw
//     every ticker frame with a plain pre-baked Sprite whose alpha the app
//     now just toggles.
//   - `planningFlashHalo`: the tap-feedback halo (5 concentric alpha rings
//     in the original live version), baked once as a smooth radial falloff
//     tinted at runtime via `sprite.tint`, same convention as every other
//     icon in this atlas.
//   - `textComposerFuseBar`: a plain solid-white bar, tinted at runtime via
//     `sprite.tint` — replaces TextComposer's ModeRowEngine
//     .clear().moveTo().lineTo().stroke() fuse-rope redraw (live every
//     frame while 'fuse' mode is active) with a single Sprite whose own
//     `width`/`height` the app just stretches. Flat rectangle, not a
//     rounded-cap capsule: at the rope's actual 3px thickness the
//     difference from a round cap is imperceptible, and a plain rectangle
//     scales to any rope length with zero distortion (a baked rounded cap
//     would stretch into an oval under the same non-uniform width scaling).
//
// Uses the Chromium already bundled for this project's own Playwright
// testing (no new rasterization dependency) purely as an offline renderer:
// lays every cell out in a fixed grid on one page, then screenshots that
// page once. The grid math here and the frame rects written to the JSON
// manifest must agree — they're computed from the exact same CELL_SIZE/
// COLUMNS constants, not by hand.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const { ALL_ICON_NAMES, standaloneIconSvg } = await import(
  path.join(projectRoot, 'src/ui/icons.ts')
);

const CELL_SIZE = 128;
const COLUMNS = 7;

// The exact 13 icons PlanningIconColumn's rows reference (see
// PlanningScreen.ts's buildIconRowSpecs() + ColumnContainer's setRecording()
// swap between recordDot/squareStop) — not "every icon", specifically so
// this baked-glow set stays small and its membership stays traceable to one
// real call site instead of ballooning to cover icons no row ever shows.
const PLANNING_GLOW_ICONS = [
  'palette', 'sparkles', 'sliders', 'shuffle', 'fireworksMood', 'mapPin',
  'shapes', 'camera', 'recordDot', 'squareStop', 'image', 'gem', 'droplet',
];

// Baked to match RowComponent's own GlowFilter/DropShadowFilter constants
// this replaces (distance 8 / outerStrength up to ~3.3 bloom halo, plus a
// alpha:0.5 blur:2 offset:(0,2) drop shadow) — approximated once here via
// real compositing instead of computed live every frame.
const GLOW_ICON_INNER_SIZE = 78; // leaves (128-78)/2 = 25px of bleed room per side for the blur below
const GLOW_ICON_FILTER =
  'drop-shadow(0 2px 2px rgba(0,0,0,0.55)) drop-shadow(0 0 4px rgba(255,255,255,0.85)) drop-shadow(0 0 9px rgba(255,255,255,0.45))';

// Mirrors PlanningIconColumn's own (pre-refactor) BG_* constants exactly —
// duplicated here rather than imported since this script runs at build time
// only, outside the app's own module graph.
const PLATE_RADIUS = 20;
const PLATE_STROKE = 1.2;
const PLATE_IDLE = { top: '#201c14', bottom: '#0a0906', strokeAlpha: 0.22 };
const PLATE_ACTIVE = { top: '#5a4620', bottom: '#1c1508', strokeAlpha: 0.55 };

function plateSvg(colors) {
  const c = CELL_SIZE / 2;
  const top = c - PLATE_RADIUS;
  const bottom = c + PLATE_RADIUS;
  return `<svg width="${CELL_SIZE}" height="${CELL_SIZE}">
    <defs><linearGradient id="g" x1="${c}" y1="${top}" x2="${c}" y2="${bottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${colors.top}"/>
      <stop offset="1" stop-color="${colors.bottom}"/>
    </linearGradient></defs>
    <circle cx="${c}" cy="${c}" r="${PLATE_RADIUS}" fill="url(#g)" stroke="#fff6df" stroke-opacity="${colors.strokeAlpha}" stroke-width="${PLATE_STROKE}"/>
  </svg>`;
}

function flashHaloSvg() {
  const c = CELL_SIZE / 2;
  return `<svg width="${CELL_SIZE}" height="${CELL_SIZE}">
    <defs><radialGradient id="h" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient></defs>
    <circle cx="${c}" cy="${c}" r="${c}" fill="url(#h)"/>
  </svg>`;
}

function fuseBarSvg() {
  // A solid rectangle filling most of the cell (small margin so edge
  // antialiasing never bleeds against a neighboring cell) — stretched
  // arbitrarily at runtime via sprite.width, tinted via sprite.tint.
  const margin = 8;
  return `<svg width="${CELL_SIZE}" height="${CELL_SIZE}">
    <rect x="${margin}" y="${margin}" width="${CELL_SIZE - margin * 2}" height="${CELL_SIZE - margin * 2}" fill="#ffffff"/>
  </svg>`;
}

// Every baked cell as { name, html } — plain icons first (unchanged
// rendering, so every existing consumer's fill-fraction/appearance is
// untouched), then the PlanningIconColumn-only additions.
const cells = [
  ...ALL_ICON_NAMES.map((name) => ({
    name,
    html: standaloneIconSvg(name, CELL_SIZE, '#ffffff'),
  })),
  ...PLANNING_GLOW_ICONS.map((name) => ({
    name: `planningIcon_${name}`,
    html: `<div style="width:${CELL_SIZE}px; height:${CELL_SIZE}px; display:flex; align-items:center; justify-content:center;"><div style="filter:${GLOW_ICON_FILTER};">${standaloneIconSvg(name, GLOW_ICON_INNER_SIZE, '#ffffff')}</div></div>`,
  })),
  { name: 'planningPlateIdle', html: plateSvg(PLATE_IDLE) },
  { name: 'planningPlateActive', html: plateSvg(PLATE_ACTIVE) },
  { name: 'planningFlashHalo', html: flashHaloSvg() },
  { name: 'textComposerFuseBar', html: fuseBarSvg() },
];

const rows = Math.ceil(cells.length / COLUMNS);
const atlasWidth = COLUMNS * CELL_SIZE;
const atlasHeight = rows * CELL_SIZE;

const cellsHtml = cells
  .map((cell, i) => {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    return `<div style="position:absolute; left:${col * CELL_SIZE}px; top:${row * CELL_SIZE}px; width:${CELL_SIZE}px; height:${CELL_SIZE}px;">${cell.html}</div>`;
  })
  .join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  html, body { background: transparent; }
  #root { position: relative; width: ${atlasWidth}px; height: ${atlasHeight}px; }
</style></head><body><div id="root">${cellsHtml}</div></body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: atlasWidth, height: atlasHeight } });
await page.setContent(html, { waitUntil: 'networkidle' });

const outDir = path.join(projectRoot, 'public');
const pngPath = path.join(outDir, 'icons-atlas.png');
await page.locator('#root').screenshot({ path: pngPath, omitBackground: true });
await browser.close();

const frames = {};
cells.forEach((cell, i) => {
  const col = i % COLUMNS;
  const row = Math.floor(i / COLUMNS);
  frames[cell.name] = {
    frame: { x: col * CELL_SIZE, y: row * CELL_SIZE, w: CELL_SIZE, h: CELL_SIZE },
    sourceSize: { w: CELL_SIZE, h: CELL_SIZE },
    spriteSourceSize: { x: 0, y: 0, w: CELL_SIZE, h: CELL_SIZE },
  };
});
const manifest = {
  frames,
  meta: { image: 'icons-atlas.png', format: 'RGBA8888', size: { w: atlasWidth, h: atlasHeight }, scale: '1' },
};
writeFileSync(path.join(outDir, 'icons-atlas.json'), JSON.stringify(manifest, null, 2));

console.log(`Wrote ${pngPath} (${atlasWidth}x${atlasHeight}, ${cells.length} cells in a ${COLUMNS}x${rows} grid: ${ALL_ICON_NAMES.length} plain icons + ${PLANNING_GLOW_ICONS.length} glow-baked + 2 plates + 1 flash halo + 1 fuse bar).`);
