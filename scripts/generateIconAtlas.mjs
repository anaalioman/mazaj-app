// Pre-bakes every hand-authored line icon (src/ui/icons.ts) into one real
// pixel spritesheet (public/icons-atlas.png + icons-atlas.json) at build
// time, so the app never rasterizes SVG at runtime — see svgIconTexture.ts,
// which loads this atlas instead of decoding SVG via `new Image()`.
//
// Uses the Chromium already bundled for this project's own Playwright
// testing (no new rasterization dependency) purely as an offline renderer:
// lays every icon out in a fixed grid on one page, then screenshots that
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
const rows = Math.ceil(ALL_ICON_NAMES.length / COLUMNS);
const atlasWidth = COLUMNS * CELL_SIZE;
const atlasHeight = rows * CELL_SIZE;

const cells = ALL_ICON_NAMES.map((name, i) => ({
  name,
  col: i % COLUMNS,
  row: Math.floor(i / COLUMNS),
}));

const cellsHtml = cells
  .map(
    (c) => `<div style="position:absolute; left:${c.col * CELL_SIZE}px; top:${c.row * CELL_SIZE}px; width:${CELL_SIZE}px; height:${CELL_SIZE}px;">${standaloneIconSvg(c.name, CELL_SIZE, '#ffffff')}</div>`,
  )
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
for (const c of cells) {
  frames[c.name] = {
    frame: { x: c.col * CELL_SIZE, y: c.row * CELL_SIZE, w: CELL_SIZE, h: CELL_SIZE },
    sourceSize: { w: CELL_SIZE, h: CELL_SIZE },
    spriteSourceSize: { x: 0, y: 0, w: CELL_SIZE, h: CELL_SIZE },
  };
}
const manifest = {
  frames,
  meta: { image: 'icons-atlas.png', format: 'RGBA8888', size: { w: atlasWidth, h: atlasHeight }, scale: '1' },
};
writeFileSync(path.join(outDir, 'icons-atlas.json'), JSON.stringify(manifest, null, 2));

console.log(`Wrote ${pngPath} (${atlasWidth}x${atlasHeight}, ${ALL_ICON_NAMES.length} icons in a ${COLUMNS}x${rows} grid).`);
