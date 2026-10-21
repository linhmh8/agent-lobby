import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "./paseo-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { createDirectoryController, type DirectoryApi, type DirectoryController } from "./directory-controller";
import { HIDE_AFTER_MS, wakeDelay } from "./wake";
import { workspaceFeedFor } from "./workspace-feed";

export { fetchWorkspaces } from "./directory-controller";

export interface Directory {
  agents: ReadonlyMap<string, PaseoAgent>;
  workspaces: ReadonlyMap<string, PaseoWorkspace>;
  phase: "loading" | "ready" | "error";
  error: string | null;
  truncated: boolean;
  reload: () => void;
}

/**
 * The agents and workspaces of this daemon, loaded once and then followed live;
 * `createDirectoryController` does the work, this hook holds its results.
 *
 * While `shown` is false nothing is held: no subscription, no timer, no
 * request. What was loaded stays as it was, and showing again loads once.
 */
export function useDirectory(paseo: PaseoApi, shown = true): Directory {
  const [agents, setAgents] = useState<ReadonlyMap<string, PaseoAgent>>(() => new Map());
  const [workspaces, setWorkspaces] = useState<ReadonlyMap<string, PaseoWorkspace>>(() => new Map());
  const [phase, setPhase] = useState<Directory["phase"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const controller = useRef<DirectoryController | null>(null);

  useEffect(() => {
    if (!shown) return;
    const api: DirectoryApi = paseo;
    const mine = createDirectoryController(api, workspaceFeedFor(paseo), {
      agents: setAgents,
      workspaces: setWorkspaces,
      phase: setPhase,
      error: setError,
      truncated: setTruncated,
    });
    controller.current = mine;
    mine.start();
    return () => {
      mine.stop();
      if (controller.current === mine) controller.current = null;
    };
  }, [paseo, shown]);

  const reload = useCallback(() => controller.current?.reload(), []);

  return { agents, workspaces, phase, error, truncated, reload };
}

/** Runs `onWake` once, just past `at`; nothing while `at` is null. `turn` re-arms it for the same moment. */
export function useWake(at: number | null, turn: number, onWake: () => void): void {
  const latest = useRef(onWake);
  latest.current = onWake;
  useEffect(() => {
    const delay = wakeDelay(at, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => latest.current(), delay);
    return () => clearTimeout(timer);
  }, [at, turn]);
}

/**
 * Whether the pane counts as shown: at once when it has a size, and only after
 * it has had none for `HIDE_AFTER_MS` when it has not.
 */
export function useShown(sized: boolean): boolean {
  const [held, setHeld] = useState(sized);
  useEffect(() => {
    if (sized) {
      setHeld(true);
      return;
    }
    // Nothing to let go of when it was not shown: a pane not laid out yet starts no timer.
    if (!held) return;
    const timer = setTimeout(() => setHeld(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [sized, held]);
  return sized || held;
}
