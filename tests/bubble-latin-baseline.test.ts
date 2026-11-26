import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bubble, bubbleSize, type BubbleSpec } from "../client/pixel/bubble";
import type { Bitmap } from "../client/pixel/grid";

/**
 * Pins the bitmaps of text the font can draw, as they were at e23536c, before CJK bubbles got
 * a system-text overlay. Every one of these must keep its key, size, anchor and pixels.
 */

const LONG = "Checking the current state of the repository before making any changes to it";

const CASES: Readonly<Record<string, BubbleSpec>> = {
  latin: { text: "Running the tests now", tone: "say" },
  digits: { text: "12 of 159 passed, 3.5s", tone: "say" },
  vietnamese: { text: "Đang kiểm tra hiện trạng", tone: "say" },
  emojiOnly: { text: "🎉🎉", tone: "say" },
  emojiAndLatin: { text: "done 🎉 ok", tone: "tell" },
  empty: { text: "", tone: "say" },
  long: { text: LONG, tone: "say" },
  longRegular: { text: LONG, tone: "say", face: "regular" },
  longTwoLines: { text: LONG, tone: "ask", maxLines: 2 },
  narrow: { text: LONG, tone: "alert", maxWidth: 30 },
  tool: { text: "Bash", tone: "tool" },
  toolCompleted: { text: "Read client/office.tsx", tone: "tool", status: "completed" },
  toolFailed: { text: "npm run check", tone: "tool", status: "failed" },
  toolCanceled: { text: "Edit", tone: "tool", status: "canceled" },
  toolRegular: { text: "Bash", tone: "tool", face: "regular" },
  tell: { text: "Asked Ada to review", tone: "tell" },
  ask: { text: "Merge this?", tone: "ask" },
  alert: { text: "Build failed", tone: "alert" },
  tailLeft: { text: "Running the tests now", tone: "say", tailX: -50 },
  tailRight: { text: "Running the tests now", tone: "say", tailX: 999 },
  tailAt: { text: "Running the tests now", tone: "say", tailX: 10 },
  whitespace: { text: "  a \n\t b  ", tone: "say" },
};

function digest(bitmap: Bitmap): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ key: bitmap.key, width: bitmap.width, height: bitmap.height, anchor: bitmap.anchor }));
  hash.update(bitmap.pixels);
  return hash.digest("hex").slice(0, 16);
}

describe("bubbles the font can draw", () => {
  it("are byte for byte what they were before the CJK overlay", () => {
    const digests = Object.fromEntries(Object.entries(CASES).map(([name, spec]) => [name, digest(bubble(spec))]));
    expect(digests).toMatchInlineSnapshot(`
      {
        "alert": "0d94aaa4ba8a1174",
        "ask": "cc5708410057e560",
        "digits": "d0f98a608d42aa23",
        "emojiAndLatin": "2b377bfa486d0516",
        "emojiOnly": "0ab24908b2c8949d",
        "empty": "59534a3be3a9326f",
        "latin": "aa318cec5383daf5",
        "long": "0aeb27f788da4b3e",
        "longRegular": "1615d5eb4e8def76",
        "longTwoLines": "6654795940d6fcfa",
        "narrow": "34c3a7d98b5d110f",
        "tailAt": "c4797ec96f0c7ade",
        "tailLeft": "1fffcf1930f313ce",
        "tailRight": "d5da872468cce46d",
        "tell": "71b8696747106a45",
        "tool": "ef7ad1351b35be31",
        "toolCanceled": "ac3e4a667bee0de6",
        "toolCompleted": "9bc4ea0fea8c6168",
        "toolFailed": "5eb63d9e76cac945",
        "toolRegular": "d11ffcf9d7e93d10",
        "vietnamese": "3fbdeb916bd83ed5",
        "whitespace": "bc2f03b04ccdeeec",
      }
    `);
  });

  it("keep their sizes", () => {
    const sizes = Object.fromEntries(Object.entries(CASES).map(([name, spec]) => [name, bubbleSize(spec)]));
    expect(sizes).toMatchInlineSnapshot(`
      {
        "alert": {
          "height": 10,
          "width": 43,
        },
        "ask": {
          "height": 10,
          "width": 49,
        },
        "digits": {
          "height": 17,
          "width": 47,
        },
        "emojiAndLatin": {
          "height": 10,
          "width": 43,
        },
        "emojiOnly": {
          "height": 10,
          "width": 7,
        },
        "empty": {
          "height": 10,
          "width": 5,
        },
        "latin": {
          "height": 17,
          "width": 64,
        },
        "long": {
          "height": 24,
          "width": 61,
        },
        "longRegular": {
          "height": 32,
          "width": 88,
        },
        "longTwoLines": {
          "height": 17,
          "width": 61,
        },
        "narrow": {
          "height": 24,
          "width": 27,
        },
        "tailAt": {
          "height": 17,
          "width": 64,
        },
        "tailLeft": {
          "height": 17,
          "width": 64,
        },
        "tailRight": {
          "height": 17,
          "width": 64,
        },
        "tell": {
          "height": 17,
          "width": 54,
        },
        "tool": {
          "height": 9,
          "width": 19,
        },
        "toolCanceled": {
          "height": 9,
          "width": 20,
        },
        "toolCompleted": {
          "height": 9,
          "width": 63,
        },
        "toolFailed": {
          "height": 9,
          "width": 59,
        },
        "toolRegular": {
          "height": 13,
          "width": 35,
        },
        "vietnamese": {
          "height": 17,
          "width": 52,
        },
        "whitespace": {
          "height": 10,
          "width": 14,
        },
      }
    `);
  });
});
