import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { WALL_REACH, WALL_SHADOW, frameArt, roomArt } from "../client/backdrop";
import { buildForest, groupByWorkspace } from "../client/model";
import { layoutOffice, type Office, type Rect } from "../client/office-model";
import { SHADOW_OF, slotIndex } from "../client/pixel/palette";

let clock = 0;
function agent(id: string, workspaceId: string): PaseoAgent {
  clock += 1;
  const createdAt = new Date(Date.parse("2026-10-15T00:00:00.000Z") + clock * 1_000).toISOString();
  return {
    id,
    provider: "claude",
    cwd: "/repo",
    workspaceId,
    model: "model",
    thinkingOptionId: null,
    createdAt,
    updatedAt: createdAt,
    lastUserMessageAt: null,
    status: "running",
    activeTurn: null,
    capabilities: {} as PaseoAgent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  } as PaseoAgent;
}

/** Three workspaces: at 20 tiles two side by side and one under them, at 18 one beside a hallway. */
function plan(width = 20): Office {
  const agents = [
    ...["a1", "a2", "a3", "a4"].map((id) => agent(id, "ws-a")),
    ...["b1", "b2"].map((id) => agent(id, "ws-b")),
    ...["c1", "c2", "c3"].map((id) => agent(id, "ws-c")),
  ];
  return layoutOffice(groupByWorkspace(buildForest(agents, null), new Map()), { width });
}

const TILE = 16;
const shadows = SHADOW_OF.map(([base]) => slotIndex(`${base}Shadow`));
const MID = TILE / 2;
const reach = WALL_REACH;

describe("roomArt", () => {
  it("draws the floor up to the middle of the walls and nothing past it", () => {
    for (const room of plan().rooms) {
      const art = roomArt(room);
      expect([art.width, art.height]).toEqual([room.width * TILE, room.height * TILE]);
      for (let y = 0; y < art.height; y += 1) {
        for (let x = 0; x < art.width; x += 1) {
          const inside = x >= MID && x < art.width - MID && y >= MID && y < art.height - MID;
          expect(art.pixels[y * art.width + x] !== 0, `${x},${y}`).toBe(inside);
        }
      }
      expect(roomArt(room)).toBe(art);
    }
  });

  it("keeps the doormat on its own tile, not carried into the wall beside it", () => {
    const room = plan().rooms[0]!;
    const art = roomArt(room);
    const mat = slotIndex("potShade");
    const column = (x: number) => Array.from({ length: TILE }, (_, y) => art.pixels[((room.floorTop - room.y) * TILE + y) * art.width + x]);
    expect(column((room.door.x - room.x) * TILE + 3)).toContain(mat);
    for (let x = MID; x < TILE; x += 1) expect(column(x)).not.toContain(mat);
  });
});

describe("frameArt", () => {
  const office = plan();
  const depth = office.building!.depth;
  const frame = frameArt(office.rooms, depth);
  const at = (x: number, y: number) => frame.pixels[y * frame.width + x]!;

  it("lays the rooms out as three, two side by side and one under them", () => {
    const [a, b, c] = office.rooms as unknown as [Rect, Rect, Rect];
    expect(b.x).toBe(a.x + a.width - 1);
    expect(c.y).toBeGreaterThan(a.y);
  });

  it("draws a wall two rooms share as one slab along the middle of its tiles", () => {
    const [a] = office.rooms as unknown as [Rect];
    const column = (a.x + a.width - 1) * TILE;
    const y = (a.y + 3) * TILE + 5;
    const across = Array.from({ length: TILE }, (_, x) => at(column + x, y) !== 0);
    const slab = across.flatMap((on, x) => (on ? [x] : []));
    expect(slab).toEqual(Array.from({ length: 2 * reach }, (_, index) => MID - reach + index));
  });

  it("is clear inside rooms but for their walls, and outside the building", () => {
    for (const room of office.rooms) {
      const x = (room.x + 3) * TILE + 4;
      const y = (room.y + 3) * TILE + 4;
      expect(at(x, y)).toBe(0);
    }
    // The half tile beyond the outer wall.
    expect(at(2, 2)).toBe(0);
    expect(at(frame.width - 1, MID + reach + 4)).toBe(0);
  });

  it("draws the same walls whatever order the rooms come in", () => {
    const reversed = frameArt([...office.rooms].reverse().map((room) => ({ ...room, x: room.x, y: room.y })), depth);
    expect(reversed.pixels).toEqual(frame.pixels);
  });

  it("fills the hallway between rooms", () => {
    // At 18 tiles the third room goes under the first two, leaving hallway right of the first.
    const narrow = plan(18);
    const [first, , third] = narrow.rooms as unknown as [Rect, Rect, Rect];
    expect(third.x).toBeGreaterThan(first.x);
    const art = frameArt(narrow.rooms, narrow.building!.depth);
    const x = (first.x + first.width + 1) * TILE + 3;
    const y = (first.y + 2) * TILE + 3;
    expect(art.pixels[y * art.width + x]).toBe(slotIndex("floorAlt"));
  });

  it("casts the shadow of a wall two pixels east of it, onto the room's own floor", () => {
    const room = office.rooms[1]!;
    const art = roomArt(room);
    const y = 4 * TILE + 5;
    const pixel = (x: number) => art.pixels[y * art.width + x];
    for (let x = MID + reach; x < MID + reach + WALL_SHADOW; x += 1) expect(String(pixel(x))).toMatch(new RegExp(`^(${shadows.join("|")})$`));
    expect(shadows).not.toContain(pixel(MID + reach + WALL_SHADOW));
  });
});
