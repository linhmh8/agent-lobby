import { describe, expect, it } from "vitest";
import {
  BOTTOM_DOCK_SHARE,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  OFFICE_MIN_HEIGHT,
  OFFICE_MIN_WIDTH,
  SIDE_DOCK_MAX_WIDTH,
  SIDE_DOCK_WIDTH,
  bottomDockHeight,
  readSize,
  sideDockWidth,
} from "../client/dock-model";

describe("sideDockWidth", () => {
  it("is two fifths of the pane, between its bounds, until it is dragged", () => {
    expect(sideDockWidth(720, null)).toBe(SIDE_DOCK_WIDTH);
    expect(sideDockWidth(900, null)).toBe(360);
    expect(sideDockWidth(1600, null)).toBe(SIDE_DOCK_MAX_WIDTH);
  });

  it("takes the dragged width, leaving the office its share", () => {
    expect(sideDockWidth(1400, 600)).toBe(600);
    expect(sideDockWidth(1400, 100)).toBe(DOCK_MIN_WIDTH);
    expect(sideDockWidth(1400, 5000)).toBe(1400 - OFFICE_MIN_WIDTH);
    // Kept from a wide pane and opened in a narrower one: still leaves the office its share.
    expect(sideDockWidth(800, 900)).toBe(800 - OFFICE_MIN_WIDTH);
  });
});

describe("bottomDockHeight", () => {
  it("takes its share of the column until it is dragged", () => {
    expect(bottomDockHeight(500, null)).toBe(500 * BOTTOM_DOCK_SHARE);
    expect(bottomDockHeight(0, null)).toBe(0);
  });

  it("takes the dragged height, leaving the office its share", () => {
    expect(bottomDockHeight(600, 300)).toBe(300);
    expect(bottomDockHeight(600, 10)).toBe(DOCK_MIN_HEIGHT);
    expect(bottomDockHeight(600, 5000)).toBe(600 - OFFICE_MIN_HEIGHT);
  });
});

describe("readSize", () => {
  it("reads back a positive size and refuses anything else", () => {
    expect(readSize("420")).toBe(420);
    expect(readSize("1.5")).toBe(1.5);
    for (const text of [null, "", "0", "-3", "NaN", "Infinity", "abc", "1e9"]) expect(readSize(text)).toBeNull();
  });
});
