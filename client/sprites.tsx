import type { PluginTheme } from "@getpaseo/plugin";
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { CrewState } from "./model";
import { Strip } from "./motion";
import { loopOf, type Cycle } from "./motion-model";
import { frameArt, frameKey, roomArt, roomKey } from "./backdrop";
import type { Emote, Rect, Room } from "./office-model";
import {
  BUBBLE_MAX_WIDTH,
  archiveLevel,
  bubbleSize as artBubbleSize,
  tag,
  Sprite,
  anchored,
  deviceCrispScale,
  deviceSnap,
  bubble,
  characterAnimation,
  deskAnimation,
  emoteAnimation,
  stateIcon,
  emote,
  lookFor,
  officePalette,
  prop,
  TILE as ART_TILE,
  CHARACTER_FRAMES,
  type Animation,
  type CharacterPose as ArtPose,
  type EmoteId,
  type Facing,
} from "./pixel";
import { CHARACTER_HEIGHT, type Heading, type SpriteRole } from "./scene-model";

/**
 * The only module of the scene that knows the sprite catalogue in
 * `client/pixel/`. The scene asks for a character, a desk, a room; this maps
 * the ask to a drawing and places its anchor.
 *
 * Sizes are in tiles and every component fills the box the scene gives it,
 * drawing past its top edge where the art is taller: a character 1 × 1.5,
 * a desk 2 × 1 with its monitor rising above, a chair 1 × 1, an emote 1 × 1,
 * a message marker 1 × 1.
 */

export type CharacterPose =
  /** Seated, hands on the keyboard. */
  | "type"
  /** Seated, still. */
  | "sit"
  /** Seated, head down. */
  | "sleep"
  /** On its feet, still. */
  | "stand"
  /** Mid-step. */
  | "walk"
  /** Standing with a cup; the second frame lifts it. */
  | "drink"
  /** Standing, talking; the second frame opens the mouth and lifts a hand. */
  | "talk"
  /** Standing; the second frame has both arms up. */
  | "stretch"
  /** Seated, eyes shut, nodding. */
  | "doze";

export type ScreenState = "on" | "off" | "error";

export interface SpriteProps {
  theme: PluginTheme;
  /** Pixels per tile; from `crispTile`, so that art pixels land on device pixels. */
  tile: number;
}

/** Layout pixels per art pixel. The scene picks a tile size that keeps this crisp on the device. */
const artScale = (tile: number) => tile / ART_TILE;

/**
 * The tile size, in layout pixels, nearest to `scale` art-pixel sizes that the
 * device can draw without blur: one art pixel is a whole number of device pixels.
 */
export function crispTile(scale: number): number {
  return ART_TILE * deviceCrispScale(scale, "nearest");
}

/** A layout length moved to the nearest device pixel, for offsets that are not whole tiles. */
export function snapToDevice(value: number): number {
  return deviceSnap(value);
}

function pose(wanted: CharacterPose, heading: Heading): { pose: ArtPose; facing: Facing } {
  switch (wanted) {
    case "type":
      return { pose: "sit", facing: "up" };
    case "sit":
      return { pose: "sit", facing: heading === "up" ? "up" : "down" };
    case "sleep":
      return { pose: "sleep", facing: "up" };
    case "stand":
      return { pose: "idle", facing: heading };
    case "walk":
      return { pose: "walk", facing: heading };
    case "drink":
    case "talk":
      // Drawn from the front and the sides; seen from behind it just stands.
      return heading === "up" ? { pose: "idle", facing: "up" } : { pose: wanted, facing: heading };
    case "stretch":
      return { pose: "stretch", facing: heading === "up" ? "up" : "down" };
    case "doze":
      return { pose: "doze", facing: "down" };
  }
}

/**
 * How long each frame of a loop shows, in milliseconds. A loop costs a repaint
 * per change of frame and nothing else, so these are as slow as still reads:
 * a screen that is busy, a bubble that bobs, a sleeper's Zs.
 */
export const FRAME_MS = {
  /** A walking step, and half of it is not a step. */
  walk: 140,
  /** Typing, and the beat activities are counted in. */
  beat: 280,
  /** A working screen scrolls a line. */
  screen: 320,
  readyBob: 800,
  zzz: 900,
  icon: { "needs-input": 140, failed: 1000, working: 320, ready: 320, idle: 800, closed: 1000 },
} as const;

/** A loop drawn from its strip with its anchor at (`x`, `y`); the still when there is nothing to play. */
function Loop({
  theme,
  animation,
  scale,
  cycle,
  paused,
  x,
  y,
}: {
  theme: PluginTheme;
  animation: Animation;
  scale: number;
  cycle: Cycle | null;
  paused: boolean;
  x: number;
  y: number;
}) {
  const palette = officePalette(theme);
  const at = anchored(animation.still, scale, x, y);
  // A cycle may count frames past the strip's end, as a frame number always could: it wraps.
  const played = useMemo(
    () => (cycle ? { frames: cycle.frames.map((frame) => frame % animation.frames), beatMs: cycle.beatMs } : null),
    [cycle, animation.frames],
  );
  if (!played || animation.frames === 1 || played.frames.every((frame) => frame === played.frames[0])) {
    return <Sprite sprite={animation.still} palette={palette} scale={scale} style={at} />;
  }
  return (
    <Strip
      count={animation.frames}
      width={animation.frameWidth * scale}
      height={animation.frameHeight * scale}
      cycle={played}
      paused={paused}
      style={at}
    >
      <Sprite sprite={animation.strip} palette={palette} scale={scale} />
    </Strip>
  );
}

export const CharacterSprite = memo(function CharacterSprite({
  theme,
  tile,
  agentId,
  role,
  pose: wanted,
  heading,
  cycle = null,
  paused = false,
  carry = null,
  lift = 0,
}: SpriteProps & {
  /** Decides the look; the same id is always the same person. */
  agentId: string;
  role: SpriteRole;
  pose: CharacterPose;
  heading: Heading;
  /** Which frame of the pose shows on each beat; null for the still. */
  cycle?: Cycle | null;
  /** Held where it is: its room is out of view. */
  paused?: boolean;
  carry?: "cup" | "book" | null;
  /** Art pixels to raise it, so a sitter rests on a seat. */
  lift?: number;
}) {
  const scale = artScale(tile);
  const animation = characterAnimation({ role, look: lookFor(agentId), ...pose(wanted, heading), carry });
  return (
    <View style={{ width: tile, height: tile * CHARACTER_HEIGHT }}>
      <Loop theme={theme} animation={animation} scale={scale} cycle={cycle} paused={paused} x={tile / 2} y={tile * CHARACTER_HEIGHT - lift * scale} />
    </View>
  );
});

// What is finished bobs gently until it is read; a sleeper's Zs drift; the rest hold still.
const EMOTE: Record<Emote, EmoteId> = { question: "question", alert: "fail", check: "readyBob", zzz: "zzz" };
const EMOTE_MS: Partial<Record<Emote, number>> = { check: FRAME_MS.readyBob, zzz: FRAME_MS.zzz };

/** How many frames each loop has, for whoever runs it. */
export const WALK_FRAMES = CHARACTER_FRAMES.walk;
export const TYPE_FRAMES = CHARACTER_FRAMES.sit;

export const EmoteSprite = memo(function EmoteSprite({
  theme,
  tile,
  kind,
  still = false,
  paused = false,
}: SpriteProps & { kind: Emote; still?: boolean; paused?: boolean }) {
  const scale = artScale(tile);
  const animation = emoteAnimation(EMOTE[kind]);
  const ms = EMOTE_MS[kind];
  const cycle = useMemo(() => (still || ms === undefined ? null : loopOf(animation.frames, ms)), [still, ms, animation.frames]);
  return (
    <View style={{ width: tile, height: tile }}>
      <Loop theme={theme} animation={animation} scale={scale} cycle={cycle} paused={paused} x={tile / 2} y={tile} />
    </View>
  );
});

const SCREEN = { on: "lit", off: "off", error: "error" } as const;

/** A desk two tiles wide; its monitor rises above the box. With `busy`, a lit screen scrolls. */
export const DeskSprite = memo(function DeskSprite({
  theme,
  tile,
  screen,
  busy = false,
  paused = false,
}: SpriteProps & { screen: ScreenState; busy?: boolean; paused?: boolean }) {
  const scale = artScale(tile);
  const animation = deskAnimation(SCREEN[screen]);
  const cycle = useMemo(() => (busy ? loopOf(animation.frames, FRAME_MS.screen) : null), [busy, animation.frames]);
  return (
    <View style={{ width: tile * 2, height: tile }}>
      <Loop theme={theme} animation={animation} scale={scale} cycle={cycle} paused={paused} x={tile} y={tile} />
    </View>
  );
});

const ICON_ART = stateIcon("closed").frameWidth;

/** Layout pixels across a state icon: 16 where the screen can draw that crisply, 14.4 at 1.67×. */
export const STATE_ICON_SIZE = ICON_ART * deviceCrispScale(16 / ICON_ART);

/**
 * An agent's state as a small picture, for a row of text: a shape of its own
 * for each state, in the state's colour, moving a little where the state is one that goes on.
 */
export const StateIcon = memo(function StateIcon({
  theme,
  state,
  still = false,
}: {
  theme: PluginTheme;
  state: CrewState;
  /** Reduced motion: the first frame. */
  still?: boolean;
}) {
  const animation = stateIcon(state);
  const scale = STATE_ICON_SIZE / ICON_ART;
  const cycle = useMemo(() => (still ? null : loopOf(animation.frames, FRAME_MS.icon[state])), [still, animation.frames, state]);
  return (
    <View accessible={false} style={{ width: STATE_ICON_SIZE, height: STATE_ICON_SIZE }}>
      <Loop
        theme={theme}
        animation={animation}
        scale={scale}
        cycle={cycle}
        paused={false}
        x={animation.anchor.x * scale}
        y={animation.anchor.y * scale}
      />
    </View>
  );
});

export const ChairSprite = memo(function ChairSprite({ theme, tile }: SpriteProps) {
  const scale = artScale(tile);
  const bitmap = prop("chair");
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} style={anchored(bitmap, scale, tile / 2, tile)} />
    </View>
  );
});

/** The envelope that travels between two desks. */
export const MarkerSprite = memo(function MarkerSprite({ theme, tile }: SpriteProps) {
  const scale = artScale(tile);
  const bitmap = prop("envelope");
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite
        sprite={bitmap}
        palette={officePalette(theme)}
        scale={scale}
        style={anchored(bitmap, scale, tile / 2, tile / 2 + (bitmap.height * scale) / 2)}
      />
    </View>
  );
});

/**
 * A room's floor, walls, pantry and lounge with their furniture, flattened into one
 * image. The drawing depends on the room's shape and not on where it stands,
 * so rooms of the same shape share it.
 */
export interface BubbleArt {
  text: string;
  tone: "say" | "tool" | "tell" | "ask" | "alert";
  status?: "running" | "completed" | "failed" | "canceled";
}

/**
 * Bubbles and count plates are drawn at the room's own scale, so that a
 * one-word bubble is about as wide as the character it belongs to and nothing
 * said is larger than whoever says it. The words are small; the full line is
 * on the accessibility label.
 */

/** The most a bubble may take of a width of `availablePx`, in art pixels. */
function bubbleMaxWidth(tile: number, availablePx: number): number {
  return Math.max(24, Math.min(BUBBLE_MAX_WIDTH, Math.floor((availablePx - 8) / artScale(tile))));
}

/**
 * A bubble's size in layout pixels, without drawing it. The catalogue folds
 * the text to its font, wraps it to at most three lines and cuts the rest.
 */
export function bubbleSize(art: BubbleArt, tile: number, availablePx: number): { width: number; height: number } {
  const scale = artScale(tile);
  const size = artBubbleSize({ ...art, maxWidth: bubbleMaxWidth(tile, availablePx) });
  return { width: size.width * scale, height: size.height * scale };
}

/**
 * A speech bubble with its words drawn in: one image. `tail` is where the tail
 * points, in layout pixels from the bubble's left edge, so it still points at
 * the speaker when the bubble has been pushed in from an edge of the office.
 */
export const BubbleSprite = memo(function BubbleSprite({
  theme,
  tile,
  art,
  availablePx,
  tail,
}: SpriteProps & { art: BubbleArt; availablePx: number; tail: number }) {
  const scale = artScale(tile);
  const bitmap = bubble({ ...art, maxWidth: bubbleMaxWidth(tile, availablePx), tailX: Math.round(tail / scale) });
  return <Sprite sprite={bitmap} palette={officePalette(theme)} scale={scale} />;
});

/**
 * The filing cabinet a room keeps its closed agents in, one tile wide and
 * standing on the bottom of the box it is given, with the count on a plate
 * above it. Fuller drawers for more of them.
 */
export const ArchiveSprite = memo(function ArchiveSprite({
  theme,
  tile,
  count,
  label,
}: SpriteProps & { count: number; label: string }) {
  const scale = artScale(tile);
  const cabinet = prop("archive", { level: archiveLevel(count) });
  const plate = tag(label);
  const top = tile - cabinet.height * scale;
  return (
    <View style={{ width: tile, height: tile }}>
      <Sprite sprite={cabinet} palette={officePalette(theme)} scale={scale} style={anchored(cabinet, scale, tile / 2, tile)} />
      <Sprite sprite={plate} palette={officePalette(theme)} scale={scale} style={anchored(plate, scale, tile / 2, top - scale)} />
    </View>
  );
});

/**
 * The walls of the whole floor plan and the hallway between its rooms, as one
 * image drawn over the rooms: a wall two rooms share is drawn once.
 * `depth[x]` is how far down column x goes.
 */
export const FrameBackdrop = memo(function FrameBackdrop({
  theme,
  tile,
  rooms,
  depth,
}: SpriteProps & { rooms: readonly Rect[]; depth: readonly number[] }) {
  // The layout is rebuilt on every directory update; the frame only when a room moves or changes shape.
  const key = frameKey(rooms, depth);
  const bitmap = useMemo(() => frameArt(rooms, depth), [key]);
  return (
    <Sprite sprite={bitmap} palette={officePalette(theme)} scale={artScale(tile)} style={{ position: "absolute", left: 0, top: 0 }} />
  );
});

export const RoomBackdrop = memo(function RoomBackdrop({ theme, tile, room }: SpriteProps & { room: Room }) {
  // The layout is rebuilt on every directory update; the floor only when the room changes shape.
  const key = roomKey(room);
  const bitmap = useMemo(() => roomArt(room), [key]);
  return (
    <Sprite
      sprite={bitmap}
      palette={officePalette(theme)}
      scale={artScale(tile)}
      style={{ position: "absolute", left: room.x * tile, top: room.y * tile }}
    />
  );
});
