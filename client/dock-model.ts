/**
 * How big the details dock is: beside the office in a wide pane, under it in
 * a narrow one, and as wide or as tall as it was last dragged to, within what
 * leaves the office room to be seen. Pure, so the view only reads numbers.
 */

/** Below this pane width the dock sits under the office instead of beside it. */
export const SIDE_DOCK_MIN_WIDTH = 720;
export const SIDE_DOCK_WIDTH = 320;
export const SIDE_DOCK_MAX_WIDTH = 420;
/** The narrowest a dock beside the office is dragged to: a chat line still reads. */
export const DOCK_MIN_WIDTH = 260;
/** Beside the dock the office keeps at least this much, an Explorer pane's width. */
export const OFFICE_MIN_WIDTH = 320;
/** The share of its column a dock under the office takes until it is dragged. */
export const BOTTOM_DOCK_SHARE = 0.4;
/** The lowest a dock under the office is dragged to: its title and a line or two. */
export const DOCK_MIN_HEIGHT = 120;
/** Over the dock the office keeps at least this much. */
export const OFFICE_MIN_HEIGHT = 120;

/**
 * The dock's width beside an office in a pane `viewWidth` wide: `wanted` if it
 * was dragged, within what leaves the office `OFFICE_MIN_WIDTH`; otherwise
 * two fifths of the pane, between `SIDE_DOCK_WIDTH` and `SIDE_DOCK_MAX_WIDTH`.
 */
export function sideDockWidth(viewWidth: number, wanted: number | null): number {
  const most = Math.max(DOCK_MIN_WIDTH, viewWidth - OFFICE_MIN_WIDTH);
  if (wanted === null) return Math.round(Math.min(SIDE_DOCK_MAX_WIDTH, Math.max(SIDE_DOCK_WIDTH, viewWidth * 0.4)));
  return Math.round(Math.min(most, Math.max(DOCK_MIN_WIDTH, wanted)));
}

/**
 * The dock's height under an office in a column `columnHeight` tall: `wanted`
 * if it was dragged, otherwise `BOTTOM_DOCK_SHARE` of the column; either way
 * leaving the office `OFFICE_MIN_HEIGHT`. Zero until the column has a height.
 */
export function bottomDockHeight(columnHeight: number, wanted: number | null): number {
  if (columnHeight <= 0) return 0;
  const most = Math.max(DOCK_MIN_HEIGHT, columnHeight - OFFICE_MIN_HEIGHT);
  const height = wanted ?? columnHeight * BOTTOM_DOCK_SHARE;
  return Math.round(Math.min(most, Math.max(Math.min(DOCK_MIN_HEIGHT, most), height)));
}

/** A size read back from storage: a positive number of pixels, or nothing. */
export function readSize(text: string | null): number | null {
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value < 100_000 ? value : null;
}
