import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useRef, useState } from "react";
import { PanResponder, View, type AccessibilityActionEvent, type ViewStyle } from "react-native";
import { MIN_TOUCH } from "./scene-model";
import { ON_WEB, resizeCursor } from "./web";

/** A finger needs the whole minimum; a mouse a strip that covers little of either side. */
const REACH = ON_WEB ? 16 : MIN_TOUCH;
/** What a screen reader's swipe moves the dock by. */
const STEP = 40;

/**
 * The edge between the office and the details dock, dragged to make the dock
 * wider or narrower beside the office, taller or shorter under it. Drawn last
 * in the row that holds both, on the dock's edge, so it is on top of either
 * side's content wherever it reaches. `size` is the dock's current width or
 * height; `onResize` is told each new one while dragging, `onRest` the last.
 */
export function DockHandle({
  theme,
  side,
  size,
  onResize,
  onRest,
}: {
  theme: PluginTheme;
  /** Beside the office, so it moves across; otherwise under it, and it moves up and down. */
  side: boolean;
  size: number;
  onResize: (size: number) => void;
  onRest: (size: number) => void;
}) {
  const latest = useRef({ side, size, onResize, onRest });
  latest.current = { side, size, onResize, onRest };
  const drag = useRef({ from: 0, to: 0 });
  const [dragging, setDragging] = useState(false);
  const responder = useMemo(() => {
    const end = () => {
      setDragging(false);
      latest.current.onRest(drag.current.to);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        // On the web a drag would otherwise select the text it passes over.
        event.preventDefault();
        drag.current = { from: latest.current.size, to: latest.current.size };
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) => {
        // The dock is right of or under the edge: pulling the edge away from it makes it larger.
        const to = Math.round(drag.current.from - (latest.current.side ? gesture.dx : gesture.dy));
        if (to === drag.current.to) return;
        drag.current.to = to;
        latest.current.onResize(to);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const by = event.nativeEvent.actionName === "increment" ? STEP : event.nativeEvent.actionName === "decrement" ? -STEP : 0;
    if (by === 0) return;
    onResize(size + by);
    onRest(size + by);
  };
  const place: ViewStyle = side
    ? { top: 0, bottom: 0, right: size - REACH / 2, width: REACH, alignItems: "center", justifyContent: "center" }
    : { left: 0, right: 0, bottom: size - REACH / 2, height: REACH, alignItems: "center", justifyContent: "center" };
  const grip = dragging ? theme.colors.foregroundMuted : theme.colors.border;
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={side ? "Width of the details" : "Height of the details"}
      accessibilityValue={{ text: `${Math.round(size)} points` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={onAccessibilityAction}
      style={[{ position: "absolute", zIndex: 2 }, place, resizeCursor(side) as ViewStyle | null]}
    >
      <View
        style={{
          width: side ? 4 : 32,
          height: side ? 32 : 4,
          borderRadius: 2,
          backgroundColor: grip,
        }}
      />
    </View>
  );
}
