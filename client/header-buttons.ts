import type { PluginButtonRegistration } from "@getpaseo/plugin/client";
import { fetchWorkspaces, type DirectoryApi } from "./directory-controller";
import { workspaceFeedFor, type WorkspaceFeed } from "./workspace-feed";

export const RESYNC_DEBOUNCE_MS = 500;

/** What the buttons need of `PluginClientContext`. */
export interface HeaderButtonHost {
  paseo: DirectoryApi;
  addHeaderButton(contribution: {
    id: string;
    workspaceId: string;
    button: {
      title: string;
      icon: "Users";
      behavior: { kind: "action"; onPress(): void };
    };
  }): Pick<PluginButtonRegistration, "remove">;
  openPanel(panelId: string, options: { workspaceId: string; location: "explorer" }): void;
}

/**
 * Puts a Lobby button on every workspace header. Pressing it opens Lobby as an Explorer tab,
 * next to Files and Changes; the tab then persists with that workspace's layout. Header buttons
 * are registered per workspace, so the set follows the workspace list: a share of the plugin's
 * workspace feed keeps `workspaces.subscribe` fed for the life of the plugin.
 */
export function addCrewHeaderButtons(
  client: HeaderButtonHost,
  workspaceFeed: WorkspaceFeed = workspaceFeedFor(client.paseo),
): () => void {
  const buttons = new Map<string, Pick<PluginButtonRegistration, "remove">>();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function sync(): Promise<void> {
    const workspaces = await fetchWorkspaces(client.paseo);
    if (disposed) return;
    for (const [workspaceId, button] of buttons) {
      if (workspaces.has(workspaceId)) continue;
      button.remove();
      buttons.delete(workspaceId);
    }
    for (const workspaceId of workspaces.keys()) {
      if (buttons.has(workspaceId)) continue;
      buttons.set(
        workspaceId,
        client.addHeaderButton({
          id: "lobby",
          workspaceId,
          button: {
            title: "Show Lobby in Explorer",
            icon: "Users",
            behavior: {
              kind: "action",
              onPress() {
                client.openPanel("lobby", { workspaceId, location: "explorer" });
              },
            },
          },
        }),
      );
    }
  }

  const resync = () => void sync().catch(() => {});
  const resyncSoon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      resync();
    }, RESYNC_DEBOUNCE_MS);
  };
  resync();
  const unsubscribe = client.paseo.workspaces.subscribe(resyncSoon);
  // Restored after a break: what changed in between was not replayed.
  const releaseFeed = workspaceFeed.acquire(resyncSoon);

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    releaseFeed();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
