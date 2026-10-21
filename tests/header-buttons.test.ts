import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESYNC_DEBOUNCE_MS, addCrewHeaderButtons, type HeaderButtonHost } from "../client/header-buttons";
import { createWorkspaceFeed } from "../client/workspace-feed";
import { fakeDaemon, workspace } from "./fake-daemon";

const settle = () => vi.advanceTimersByTimeAsync(0);

function setup() {
  const daemon = fakeDaemon();
  daemon.workspaces.set("ws-a", workspace("ws-a", "Alpha"));
  const buttons = new Set<string>();
  const opened: string[] = [];
  const presses = new Map<string, () => void>();
  const client: HeaderButtonHost = {
    paseo: daemon.api,
    addHeaderButton(contribution) {
      buttons.add(contribution.workspaceId);
      presses.set(contribution.workspaceId, contribution.button.behavior.onPress);
      return { remove: () => buttons.delete(contribution.workspaceId) };
    },
    openPanel(_panelId, options) {
      opened.push(options.workspaceId);
    },
  };
  const feed = createWorkspaceFeed(daemon.api);
  const dispose = addCrewHeaderButtons(client, feed);
  return { daemon, buttons, opened, presses, dispose };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("header buttons", () => {
  it("puts a button on every workspace and opens that workspace's Lobby", async () => {
    const { buttons, opened, presses } = setup();
    await settle();
    expect([...buttons]).toEqual(["ws-a"]);
    presses.get("ws-a")?.();
    expect(opened).toEqual(["ws-a"]);
  });

  it("follows workspaces created and removed after the plugin loaded", async () => {
    const { daemon, buttons } = setup();
    await settle();
    daemon.emitWorkspace(workspace("ws-b", "Beta"));
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);
    expect([...buttons].sort()).toEqual(["ws-a", "ws-b"]);
    daemon.emitWorkspace(workspace("ws-a", "Alpha"), "remove");
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);
    expect([...buttons]).toEqual(["ws-b"]);
  });

  it("reads the list again when the observation was restored", async () => {
    const { daemon, buttons } = setup();
    await settle();
    // Created while the connection was down: no event for it.
    daemon.workspaces.set("ws-c", workspace("ws-c", "Gamma"));
    daemon.restore([...daemon.workspaceFeeds][0]);
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS);
    expect([...buttons].sort()).toEqual(["ws-a", "ws-c"]);
  });

  it("removes every button and lets go of the feed when disposed", async () => {
    const { daemon, buttons, dispose } = setup();
    await settle();
    dispose();
    await settle();
    expect(buttons.size).toBe(0);
    expect(daemon.workspaceFeeds.size).toBe(0);
    expect(daemon.workspaceListeners.size).toBe(0);
  });
});
