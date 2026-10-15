import { Platform } from "react-native";

/**
 * The only file that touches what a browser has and a phone does not. Each
 * export says what it needs of a node and nothing more, does its work on the
 * web and nothing anywhere else.
 */
export const ON_WEB = Platform.OS === "web";

/** What `slideTo` needs of the node behind a View's ref on the web. */
interface Slidable {
  style: { transform: string };
}

/**
 * Slides a mounted view sideways by a share of its own width, written straight
 * onto its node: no state changes, nothing is rendered again. The view's own
 * style must not set a transform, or the next render would put that back.
 */
export function slideTo(node: unknown, percent: number): void {
  if (!ON_WEB || node === null || typeof node !== "object" || !("style" in node)) return;
  (node as Slidable).style.transform = `translateX(${percent}%)`;
}

/** What `recall` and `remember` need of the browser's local storage. */
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "agent-lobby:";
// A phone keeps what was set until the app closes; so does a browser that refuses storage.
const session = new Map<string, string>();

function storage(): Storage | null {
  if (!ON_WEB) return null;
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** What this device was last told to keep under `key`: on the web across visits, elsewhere for this session. */
export function recall(key: string): string | null {
  const kept = session.get(key);
  if (kept !== undefined) return kept;
  try {
    return storage()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

/** Keeps `value` under `key` on this device, or forgets it for null. */
export function remember(key: string, value: string | null): void {
  if (value === null) session.delete(key);
  else session.set(key, value);
  try {
    const store = storage();
    if (value === null) store?.removeItem(PREFIX + key);
    else store?.setItem(PREFIX + key, value);
  } catch {
    // Full or refused: the session copy still holds.
  }
}

/** The pointer a resize handle shows on the web: a column or a row resize. Nothing elsewhere. */
export function resizeCursor(across: boolean): object | null {
  return ON_WEB ? { cursor: across ? "col-resize" : "row-resize" } : null;
}

/** What `anchorScroll` needs of a ScrollView: the node that scrolls. */
interface Scrollable {
  getScrollableNode(): unknown;
}

/**
 * Turns the browser's scroll anchoring on or off for a ScrollView, written straight onto its node:
 * nothing is rendered again. Anchoring keeps what is in view in place when content above it
 * changes. While a chat follows its end that is wrong: when its oldest line goes as a new one
 * comes, the height stays the same and the browser scrolls up by the line it dropped, hiding the new
 * one. Once scrolled up to read, it is right: without it the line being read moves.
 */
export function anchorScroll(scroller: unknown, anchored: boolean): void {
  if (!ON_WEB || scroller === null || typeof scroller !== "object" || !("getScrollableNode" in scroller)) return;
  const node = (scroller as Scrollable).getScrollableNode();
  if (node === null || typeof node !== "object" || !("style" in node)) return;
  (node as { style: { overflowAnchor: string } }).style.overflowAnchor = anchored ? "" : "none";
}
