import type { PluginClientContext } from "@getpaseo/plugin/client";
import { addCrewHeaderButtons } from "./client/header-buttons";
import { CrewPanel, CrewSurface } from "./client/main";

export default function contribute(client: PluginClientContext) {
  const disposers = [
    client.addWorkspacePanel({
      id: "lobby",
      title: "Lobby",
      icon: "Users",
      context: "workspace",
      locations: ["explorer", "workspace"],
      Component: CrewPanel,
    }),
    client.addScreen({ id: "lobby", title: "Lobby", Component: CrewSurface }),
    addCrewHeaderButtons(client),
    client.addCommandCenterItem({
      id: "open-lobby",
      title: "Open Lobby",
      icon: "Users",
      keywords: ["agents", "lobby", "crew", "subagents", "office", "room"],
      context: "workspace",
      onSelect: (context) => context.openPanel("lobby", { location: "explorer" }),
    }),
    client.addCommandCenterItem({
      id: "open-lobby-all",
      title: "Open Lobby across workspaces",
      icon: "Users",
      keywords: ["agents", "lobby", "crew", "office", "rooms"],
      context: "global",
      onSelect: (context) => context.openScreen({ screenId: "lobby" }),
    }),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
