import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirectoryController,
  type AgentUpdate,
  type DirectorySink,
} from "../client/directory-controller";
import { createWorkspaceFeed } from "../client/workspace-feed";
import { agent, fakeDaemon, workspace } from "./fake-daemon";

const BACKSTOP_MS = 10_000;
const DEBOUNCE_MS = 100;
const settle = () => vi.advanceTimersByTimeAsync(0);
const upsert = (entry: PaseoAgent) => ({ kind: "upsert", agent: entry }) as unknown as AgentUpdate;
const remove = (agentId: string) => ({ kind: "remove", agentId }) as unknown as AgentUpdate;

function setup() {
  const daemon = fakeDaemon();
  daemon.agents.set("a1", agent("a1"));
  daemon.workspaces.set("ws-a", workspace("ws-a", "Alpha"));
  const seen = {
    agents: [] as ReadonlyMap<string, PaseoAgent>[],
    workspaces: [] as ReadonlyMap<string, PaseoWorkspace>[],
    phases: [] as string[],
    errors: [] as (string | null)[],
  };
  const sink: DirectorySink = {
    agents: (agents) => seen.agents.push(agents),
    workspaces: (workspaces) => seen.workspaces.push(workspaces),
    phase: (phase) => seen.phases.push(phase),
    error: (error) => seen.errors.push(error),
    truncated: () => {},
  };
  const feed = createWorkspaceFeed(daemon.api, BACKSTOP_MS);
  const controller = createDirectoryController(daemon.api, feed, sink, {
    backstopMs: BACKSTOP_MS,
    workspaceDebounceMs: DEBOUNCE_MS,
  });
  const agents = () => seen.agents[seen.agents.length - 1];
  const workspaces = () => seen.workspaces[seen.workspaces.length - 1];
  return { daemon, controller, seen, agents, workspaces };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("directory controller", () => {
  it("loads once, then holds one agent observation and a share of the workspace feed", async () => {
    const { daemon, controller, seen, agents, workspaces } = setup();
    controller.start();
    await settle();
    expect(seen.phases).toEqual(["ready"]);
    expect([...agents().keys()]).toEqual(["a1"]);
    expect(workspaces().get("ws-a")?.name).toBe("Alpha");
    expect(daemon.agentFeeds.size).toBe(1);
    expect(daemon.workspaceFeeds.size).toBe(1);
  });

  it("applies agent updates in place and drops archived or removed agents", async () => {
    const { daemon, controller, agents } = setup();
    controller.start();
    await settle();
    daemon.emitAgent(upsert(agent("a2", { status: "running" })));
    expect([...agents().keys()]).toEqual(["a1", "a2"]);
    daemon.emitAgent(upsert(agent("a2", { archivedAt: "2026-10-21T00:00:00.000Z" })));
    expect([...agents().keys()]).toEqual(["a1"]);
    daemon.emitAgent(remove("a1"));
    expect(agents().size).toBe(0);
  });

  it("reads workspaces again when the daemon changes one", async () => {
    const { daemon, controller, workspaces } = setup();
    controller.start();
    await settle();
    daemon.emitWorkspace(workspace("ws-a", "Alpha renamed"));
    expect(workspaces().get("ws-a")?.name).toBe("Alpha");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(workspaces().get("ws-a")?.name).toBe("Alpha renamed");
  });

  it("asks about a workspace once when an agent turns up in one it has not heard of", async () => {
    const { daemon, controller, workspaces } = setup();
    controller.start();
    await settle();
    daemon.workspaces.set("ws-b", workspace("ws-b", "Beta"));
    const before = daemon.log.filter((line) => line === "workspaces.list").length;
    daemon.emitAgent(upsert(agent("b1", { workspaceId: "ws-b" })));
    daemon.emitAgent(upsert(agent("b2", { workspaceId: "ws-b" })));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(daemon.log.filter((line) => line === "workspaces.list").length).toBe(before + 1);
    expect(workspaces().get("ws-b")?.name).toBe("Beta");
  });

  it("loads everything again when the agent observation was restored", async () => {
    const { daemon, controller, agents } = setup();
    controller.start();
    await settle();
    // Missed while the connection was down.
    daemon.agents.set("a9", agent("a9"));
    daemon.restore([...daemon.agentFeeds][0]);
    await settle();
    expect([...agents().keys()]).toEqual(["a1", "a9"]);
  });

  it("opens the agent observation again from the backstop after the daemon dropped it", async () => {
    const { daemon, controller, agents } = setup();
    controller.start();
    await settle();
    daemon.fail([...daemon.agentFeeds][0], daemon.agentFeeds);
    expect(daemon.agentFeeds.size).toBe(0);
    daemon.agents.set("a5", agent("a5"));
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS);
    expect(daemon.agentFeeds.size).toBe(1);
    expect([...agents().keys()]).toEqual(["a1", "a5"]);
  });

  it("keeps the agent objects a refetch did not change", async () => {
    const { daemon, controller, agents, seen } = setup();
    controller.start();
    await settle();
    const known = agents();
    const count = seen.agents.length;
    daemon.agents.set("a1", agent("a1"));
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS);
    expect(seen.agents.length).toBe(count);
    expect(agents()).toBe(known);
  });

  it("keeps what it had and reports the error when a load fails after it was ready", async () => {
    const { daemon, controller, seen, agents } = setup();
    controller.start();
    await settle();
    daemon.failNext("agents");
    controller.reload();
    await settle();
    expect(seen.phases).toEqual(["ready", "ready"]);
    expect(seen.errors[seen.errors.length - 1]).toBe("agents down");
    expect([...agents().keys()]).toEqual(["a1"]);
  });

  it("lets go of everything on stop and reports nothing after", async () => {
    const { daemon, controller, seen } = setup();
    controller.start();
    await settle();
    controller.stop();
    await settle();
    const count = seen.agents.length + seen.workspaces.length;
    expect(daemon.agentFeeds.size).toBe(0);
    expect(daemon.workspaceFeeds.size).toBe(0);
    expect(daemon.agentListeners.size).toBe(0);
    expect(daemon.workspaceListeners.size).toBe(0);
    daemon.emitAgent(upsert(agent("late")));
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS);
    expect(seen.agents.length + seen.workspaces.length).toBe(count);
  });
});
