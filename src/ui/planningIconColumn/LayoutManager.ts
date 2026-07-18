import { Rectangle, type Application, type Container } from 'pixi.js';
import { COLUMN_RIGHT_INSET, HIT_MIN_SIZE, PADDING_BOTTOM, PADDING_TOP, ROW_HEIGHT, ROW_SPACING, type Row } from './types';

/**
 * Positions every row and re-sizes the column's own gap-absorbing hitArea
 * (see ColumnContainer's own doc comment) — runs once at construction and
 * again on every `renderer.resize`.
 *
 * Real, reproduced bug on short screens: centering used to clamp its offset
 * to zero once the column's natural height didn't fit, but never actually
 * shrank anything — so the tail rows (glow, then "لون المقذوفة", the very
 * last row) rendered past app.screen.height entirely, sunk below the
 * visible screen and completely unreachable. Compress the *gap* between
 * rows first — each row's own icon/label/hitArea size never changes, so
 * the 44px minimum touch target (HIT_MIN_SIZE) is never at risk — down to
 * zero gap if needed. Only past that point (an extremely short viewport)
 * does spacing hit its floor at ROW_HEIGHT itself, which still keeps every
 * row's *center* within the safe area even if adjacent rows start to
 * visually overlap — a graceful-degradation tradeoff, not a row silently
 * disappearing.
 */
export function layoutColumn(app: Application, rows: Map<string, Row>, container: Container): void {
  const ids = Array.from(rows.keys());
  const rowCount = ids.length;
  const naturalContentHeight = (rowCount - 1) * ROW_SPACING + ROW_HEIGHT;
  const availableHeight = app.screen.height - PADDING_TOP - PADDING_BOTTOM;

  const rowSpacing =
    naturalContentHeight <= availableHeight
      ? ROW_SPACING
      : Math.max(ROW_HEIGHT, (availableHeight - ROW_HEIGHT) / Math.max(rowCount - 1, 1));
  const contentHeight = (rowCount - 1) * rowSpacing + ROW_HEIGHT;
  const firstRowCenterY = PADDING_TOP + Math.max(0, (availableHeight - contentHeight) / 2) + ROW_HEIGHT / 2;
  const centerX = app.screen.width - COLUMN_RIGHT_INSET;

  ids.forEach((id, index) => {
    const row = rows.get(id)!;
    row.root.position.set(centerX, firstRowCenterY + index * rowSpacing);
  });

  // The column's own hitArea only needs to be at least as wide/tall as the
  // widest row's own real hitArea (see RowComponent's computeHitArea()) so
  // no row's content ever pokes out past it — computed from the rows'
  // actual hitAreas, not a repeated flat guess. Purely a hit-testing
  // rectangle (see ColumnContainer's own doc comment); never drawn or
  // rendered.
  let maxHalfWidth = HIT_MIN_SIZE / 2;
  let maxHalfHeight = HIT_MIN_SIZE / 2;
  for (const row of rows.values()) {
    const area = row.root.hitArea as Rectangle;
    maxHalfWidth = Math.max(maxHalfWidth, -area.left, area.right);
    maxHalfHeight = Math.max(maxHalfHeight, -area.top, area.bottom);
  }

  const lastRowCenterY = firstRowCenterY + (ids.length - 1) * rowSpacing;
  container.hitArea = new Rectangle(
    centerX - maxHalfWidth,
    firstRowCenterY - maxHalfHeight,
    maxHalfWidth * 2,
    lastRowCenterY - firstRowCenterY + maxHalfHeight * 2,
  );
}

/**
 * Where ColorPickerPanel/ShapesPanel (see SideDockPanel's `getLeftBoundary`
 * dep) should dock beside — the visual left extent of the whole column,
 * i.e. its fixed center minus whichever row currently renders widest
 * (icon or label), computed live rather than assumed, since it changes
 * with locale/label text.
 */
export function getColumnLeftEdgeX(app: Application, rows: Map<string, Row>): number {
  let maxHalfWidth = 0;
  for (const row of rows.values()) {
    maxHalfWidth = Math.max(maxHalfWidth, row.icon.width / 2, row.label.width / 2);
  }
  return app.screen.width - COLUMN_RIGHT_INSET - maxHalfWidth;
}
