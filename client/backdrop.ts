import type { Rect, Room } from "./office-model";
import { blit, drawn, type Bitmap, type Canvas } from "./pixel/grid";
import { SHADOW_OF, slotIndex } from "./pixel/palette";
import { PROPS, TILE, door, prop, tile, type TileId } from "./pixel/props";

/**
 * The office's fixed drawing: each room's floor and furniture, and over the
 * rooms one frame of walls and hallway for the whole floor plan. Pure, so it
 * can be tested and drawn anywhere.
 *
 * The plan is in tiles, and a wall is a row of tiles two rooms share. It is
 * drawn as a thin slab along the middle of that row: each side's floor runs
 * up to the slab, and the half tile beyond an outer wall stays empty. Every
 * edge, between two rooms, a room and the hallway, or the building and
 * outside, runs along tile middles, so one rule draws every run, corner, tee
 * and crossing, and a wall two rooms share is drawn once. Lit from the top
 * left, a wall casts a short shadow east and, over the hallway, south.
 */

const HALF = TILE / 2;
/** The row of the wall face a room's top wall carries on with below its slab: plain panel. */
const PANEL_ROW = 4;

/** Art pixels of slab either side of the tile middle: a wall 4 wide. */
export const WALL_REACH = 2;
/** Art pixels of shadow a wall casts on the floor east of it and, in the hallway, south of it. */
export const WALL_SHADOW = 2;

const inRect = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A crew, as against an agent on its own: more than one desk. */
const isCrew = (pod: Room["pods"][number]) => pod.teams.reduce((sum, team) => sum + team.desks.length, 0) > 1;

const POD_FLOORS: readonly TileId[] = ["pod0", "pod1", "pod2", "pod3"];

/** What a room's drawing depends on: its shape and furniture, not where it stands. */
export function roomKey(room: Room): string {
  const zones = room.zones
    .map((zone) => `${zone.kind}@${zone.x - room.x},${zone.y - room.y},${zone.width}x${zone.height}:${zone.props.map((item) => `${item.id}@${item.x - room.x},${item.y - room.y}`).join(",")}`)
    .join(";");
  const wall = room.lounge.wall ? `${room.lounge.wall.x - room.x},${room.lounge.wall.y - room.y}+${room.lounge.wall.width}` : "";
  const pods = room.pods
    .filter(isCrew)
    .map((pod) => pod.teams.map((team) => `${team.area.x - room.x},${team.area.y - room.y},${team.area.width}x${team.area.height}`).join("+"))
    .join("/");
  return `room3:${room.width}x${room.height}:f${room.floorTop - room.y}:d${room.door.x - room.x}:w${wall}:${zones}:p${pods}`;
}

/**
 * A room's floor, wall face, pantry and lounge with their furniture, as one
 * image the size of the room's tiles. Only what is inside its walls is drawn:
 * the frame draws the walls over it. Rooms of one shape share the image.
 */
export function roomArt(room: Room): Bitmap {
  return drawn(roomKey(room), room.width * TILE, room.height * TILE, (out) => drawRoom(room, out));
}

let shadeTable: Uint8Array | null = null;
/** The slot a floor or face pixel takes in a wall's shadow. */
function shaded(value: number): number {
  if (!shadeTable) {
    shadeTable = new Uint8Array(256).map((_, index) => index);
    for (const [base] of SHADOW_OF) shadeTable[slotIndex(base)] = slotIndex(`${base}Shadow`);
  }
  return shadeTable[value]!;
}

function drawRoom(room: Room, out: Canvas): void {
  // Each team of a crew (a lead's people) has a floor of its own; an agent on its own sits on the plain floor.
  const teams = room.pods.filter(isCrew).flatMap((pod) => pod.teams);
  const floorAt = (x: number, y: number): TileId => {
    if (y < room.floorTop) return "wall";
    // The half wall the appliances, the shelves and the sofa stand against.
    if (room.lounge.wall && inRect(x, y, room.lounge.wall)) return "wall";
    const zone = room.zones.find((entry) => inRect(x, y, entry));
    if (zone) return zone.kind === "pantry" ? "kitchen" : "carpet";
    const team = teams.findIndex((entry) => inRect(x, y, entry.area));
    if (team >= 0) return POD_FLOORS[team % POD_FLOORS.length] as TileId;
    if (x === room.door.x && y === room.floorTop) return "doormat";
    return "floor";
  };
  // Inside a wall, past its slab, the floor carries on; the mat stays on its own tile.
  const innerAt = (x: number, y: number): TileId => {
    const id = floorAt(x, y);
    return id === "doormat" ? "floor" : id;
  };
  const right = room.x + room.width - 1;
  const bottom = room.y + room.height - 1;
  const width = out.width;
  for (let y = room.y; y <= bottom; y += 1) {
    for (let x = room.x; x <= right; x += 1) {
      // A wall tile's inner half carries on the tile inside it; under the top wall's slab that is the face.
      const inner = x === room.x || x === right || y === room.y || y === bottom;
      const at = { x: clamp(x, room.x + 1, right - 1), y: clamp(y, room.y + 1, bottom - 1) };
      const source = tile(inner ? innerAt(at.x, at.y) : floorAt(x, y)).pixels;
      const top = y === room.y;
      for (let ly = 0; ly < TILE; ly += 1) {
        const py = (y - room.y) * TILE + ly;
        if (py < HALF || py >= out.height - HALF) continue;
        const from = (top ? PANEL_ROW : ly) * TILE;
        for (let lx = 0; lx < TILE; lx += 1) {
          const px = (x - room.x) * TILE + lx;
          if (px < HALF || px >= width - HALF) continue;
          out.pixels[py * width + px] = source[from + lx]!;
        }
      }
    }
  }
  // The left wall's shadow, lit from the top left; the right wall's falls in the room next door.
  for (let py = HALF + WALL_REACH; py < out.height - HALF - WALL_REACH; py += 1) {
    for (let px = HALF + WALL_REACH; px < HALF + WALL_REACH + WALL_SHADOW; px += 1) {
      out.pixels[py * width + px] = shaded(out.pixels[py * width + px]!);
    }
  }
  // The door stands in the wall's face, at the head of the corridor.
  blit(out, door(room.floorTop - room.y - 1), (room.door.x - room.x) * TILE, TILE);
  const furniture = room.zones.flatMap((zone) => zone.props);
  // A rug lies flat: straight after the floor, under everything else.
  for (const item of [...furniture.filter((entry) => entry.id === "rug"), ...furniture.filter((entry) => entry.id !== "rug")]) {
    const bitmap = prop(item.id);
    // Furniture stands on the bottom centre of the tiles it covers.
    blit(
      out,
      bitmap,
      (item.x - room.x) * TILE + (PROPS[item.id].tilesWide * TILE) / 2 - bitmap.anchor.x,
      (item.y - room.y + 1) * TILE - bitmap.anchor.y,
    );
  }
}

/** What the frame depends on: where each room stands and the building's outline. */
export function frameKey(rooms: readonly Rect[], depth: readonly number[]): string {
  return `frame:${depth.join(".")}:${rooms.map((room) => `${room.x},${room.y},${room.width}x${room.height}`).join(";")}`;
}

const OUTSIDE = 0;
const HALLWAY = 1;

/**
 * The walls of the whole floor plan and the hallway between its rooms, as
 * one image drawn over the rooms. Clear inside every room but for its walls,
 * and clear outside the building. `depth[x]` is how far down column x goes.
 */
export function frameArt(rooms: readonly Rect[], depth: readonly number[]): Bitmap {
  const columns = depth.length;
  const rows = Math.max(0, ...depth);
  return drawn(frameKey(rooms, depth), columns * TILE, rows * TILE, (out) => drawFrame(out, rooms, depth));
}

function drawFrame(out: Canvas, rooms: readonly Rect[], depth: readonly number[]): void {
  const columns = depth.length;
  const rows = Math.max(0, ...depth);
  // Areas change only on tile middles: cell (i, j) runs from the middle of tile (i, j) to the middle of
  // tile (i + 1, j + 1), and is outside, hallway, or one room. Cells start one before the first tile.
  const cellsWide = columns + 1;
  const cells = new Int32Array(cellsWide * (rows + 1));
  const inBuilding = (x: number, y: number) => x >= 0 && x < columns && y >= 0 && y < (depth[x] as number);
  for (let j = -1; j < rows; j += 1) {
    for (let i = -1; i < columns; i += 1) {
      const hall = inBuilding(i, j) && inBuilding(i + 1, j) && inBuilding(i, j + 1) && inBuilding(i + 1, j + 1);
      cells[(j + 1) * cellsWide + i + 1] = hall ? HALLWAY : OUTSIDE;
    }
  }
  rooms.forEach((room, index) => {
    for (let j = room.y; j < room.y + room.height - 1; j += 1) {
      for (let i = room.x; i < room.x + room.width - 1; i += 1) cells[(j + 1) * cellsWide + i + 1] = 2 + index;
    }
  });
  const area = (x: number, y: number) => {
    const i = Math.floor((x - HALF) / TILE) + 1;
    const j = Math.floor((y - HALF) / TILE) + 1;
    return i < 0 || j < 0 || i >= cellsWide || j > rows ? OUTSIDE : (cells[j * cellsWide + i] as number);
  };
  const reach = WALL_REACH;
  // On the slab: within `reach` of an edge between two areas. A slab is narrower than a cell, so the
  // corners of the square around a pixel are enough to tell.
  const slab = (x: number, y: number) => {
    const here = area(x - reach, y - reach);
    return area(x + reach, y - reach) !== here || area(x - reach, y + reach) !== here || area(x + reach, y + reach) !== here;
  };
  const rim = (x: number, y: number) =>
    slab(x, y) && !(slab(x, y - 1) && slab(x, y + 1) && slab(x - 1, y) && slab(x + 1, y));
  // In a slab's shadow: just east of it, or just south of it.
  const shadowed = (x: number, y: number) => {
    for (let k = 1; k <= WALL_SHADOW; k += 1) if (slab(x - k, y) || slab(x, y - k)) return true;
    return false;
  };
  const [outline, fill, light, shade] = (["outline", "partition", "partitionLight", "partitionShade"] as const).map(
    slotIndex,
  ) as [number, number, number, number];
  const hallway = tile("floorAlt").pixels;
  const { width, height, pixels } = out;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      if (slab(x, y)) {
        if (rim(x, y)) value = outline;
        // Lit from the top left.
        else if (rim(x, y - 1) || rim(x - 1, y)) value = light;
        else if (rim(x, y + 1) || rim(x + 1, y)) value = shade;
        else value = fill;
      } else if (area(x, y) === HALLWAY) {
        value = hallway[(y % TILE) * TILE + (x % TILE)]!;
        if (shadowed(x, y)) value = shaded(value);
      }
      pixels[y * width + x] = value;
    }
  }
}
