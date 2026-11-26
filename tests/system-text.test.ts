import { describe, expect, it } from "vitest";
import {
  BUBBLE_MAX_LINES,
  SYSTEM_TEXT_MIN_SIZE,
  bubble,
  bubbleFrame,
  bubbleFrameSize,
  bubbleSize,
  bubbleSystemType,
  bubbleTextArea,
  measuredText,
  type BubbleTone,
} from "../client/pixel/bubble";
import { slotIndex } from "../client/pixel/palette";
import { collapseSpace, needsSystemText } from "../client/pixel/text";

describe("needsSystemText", () => {
  it("is true for Korean, Chinese and Japanese", () => {
    expect(needsSystemText("정했습니다")).toBe(true);
    expect(needsSystemText("ㅎㅎ")).toBe(true);
    expect(needsSystemText("调查完毕")).toBe(true);
    expect(needsSystemText("ひらがな")).toBe(true);
    expect(needsSystemText("カタカナ")).toBe(true);
    expect(needsSystemText("ㄅㄆㄇ")).toBe(true);
    expect(needsSystemText("ＡＢＣ")).toBe(true);
    expect(needsSystemText("「完」")).toBe(true);
  });

  it("is true when CJK is mixed with Latin or emoji", () => {
    expect(needsSystemText("Q3는 (a)로 정했습니다.")).toBe(true);
    expect(needsSystemText("done 🎉 完了")).toBe(true);
  });

  it("is false for what the font folds, emoji alone, other scripts and nothing", () => {
    expect(needsSystemText("Running the tests now")).toBe(false);
    expect(needsSystemText("12 of 159 passed")).toBe(false);
    expect(needsSystemText("Đang kiểm tra hiện trạng")).toBe(false);
    expect(needsSystemText("tiếng Việt")).toBe(false);
    expect(needsSystemText("🎉🎉")).toBe(false);
    expect(needsSystemText("done 🎉 ok")).toBe(false);
    expect(needsSystemText("Готово")).toBe(false);
    expect(needsSystemText("　")).toBe(false);
    expect(needsSystemText("")).toBe(false);
  });
});

describe("collapseSpace", () => {
  it("makes whitespace runs one space and trims, like foldText", () => {
    expect(collapseSpace("  조사 완료 🎉\n\n결과는\t(a)  ")).toBe("조사 완료 🎉 결과는 (a)");
    expect(collapseSpace("")).toBe("");
  });
});

describe("system-text bubbles", () => {
  const TONES: BubbleTone[] = ["say", "tool", "tell", "ask", "alert"];

  it("leave the text area unpainted: only the fill shows where words would go", () => {
    for (const tone of TONES) {
      const spec = { tone, maxWidth: 60 } as const;
      const area = bubbleTextArea(spec);
      const frame = bubbleFrame(spec, { width: 30, height: 6 });
      const fill = frame.pixels[area.top * frame.width + area.left]!;
      for (let y = area.top; y < area.top + 6; y++) {
        for (let x = area.left; x < area.left + 30; x++) expect(frame.pixels[y * frame.width + x], `${tone} ${x},${y}`).toBe(fill);
      }
      expect(fill).not.toBe(slotIndex(area.ink));
    }
  });

  it("are the box a drawn bubble of the same text size would be", () => {
    // "go" at the small face is 7 wide and 6 tall: the frame for that much text is that bubble.
    const drawn = bubbleSize({ text: "go", tone: "say" });
    expect(bubbleFrameSize({ tone: "say" }, { width: 7, height: 6 })).toEqual(drawn);
    const frame = bubbleFrame({ tone: "say" }, { width: 7, height: 6 });
    expect({ width: frame.width, height: frame.height, anchor: frame.anchor }).toEqual({
      ...drawn,
      anchor: bubble({ text: "go", tone: "say" }).anchor,
    });
  });

  it("keep the width limit, the tail rules and the icon", () => {
    const spec = { tone: "say", maxWidth: 40 } as const;
    expect(bubbleFrameSize(spec, { width: 999, height: 6 }).width).toBe(40);
    expect(bubbleFrame({ ...spec, tailX: -50 }, { width: 20, height: 6 }).anchor.x).toBe(2);
    const width = bubbleFrameSize(spec, { width: 20, height: 6 }).width;
    expect(bubbleFrame({ ...spec, tailX: 999 }, { width: 20, height: 6 }).anchor.x).toBe(width - 3);
    expect(bubbleTextArea({ tone: "ask" }).left).toBeGreaterThan(bubbleTextArea({ tone: "say" }).left);
    expect(bubbleTextArea({ tone: "say" }).maxLines).toBe(BUBBLE_MAX_LINES);
    expect(bubbleTextArea({ tone: "tool", maxLines: 3 }).maxLines).toBe(1);
  });

  it("grow with the measured text and are never shorter than one line", () => {
    const one = bubbleFrameSize({ tone: "say" }, { width: 20, height: 6 }).height;
    expect(bubbleFrameSize({ tone: "say" }, { width: 20, height: 1 }).height).toBe(one);
    expect(bubbleFrameSize({ tone: "say" }, { width: 20, height: 20 }).height).toBe(one + 14);
  });

  it("never share a cache entry with a drawn bubble", () => {
    const drawn = bubble({ text: "go", tone: "say" });
    const frame = bubbleFrame({ tone: "say" }, { width: 7, height: 6 });
    expect(frame.key).not.toBe(drawn.key);
    expect(Array.from(frame.pixels)).not.toEqual(Array.from(drawn.pixels));
    expect(bubbleFrame({ tone: "say" }, { width: 7, height: 6 })).toBe(frame);
    expect(bubbleFrame({ tone: "say" }, { width: 7, height: 13 }).key).not.toBe(frame.key);
  });
});

describe("system type", () => {
  it("follows the face's line at the bubble's scale, and stays legible", () => {
    expect(bubbleSystemType(1)).toEqual({ fontSize: SYSTEM_TEXT_MIN_SIZE, lineHeight: 13 });
    expect(bubbleSystemType(2)).toEqual({ fontSize: 12, lineHeight: 16 });
    expect(bubbleSystemType(3)).toEqual({ fontSize: 18, lineHeight: 24 });
    expect(bubbleSystemType(0.5).fontSize).toBe(SYSTEM_TEXT_MIN_SIZE);
  });

  it("turns a measured layout size into whole art pixels, rounding up", () => {
    expect(measuredText({ width: 40, height: 26 }, 2)).toEqual({ width: 20, height: 13 });
    expect(measuredText({ width: 40.5, height: 26.2 }, 2)).toEqual({ width: 21, height: 14 });
    expect(measuredText({ width: 36, height: 13 }, 1.5)).toEqual({ width: 24, height: 9 });
  });
});
