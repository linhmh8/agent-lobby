import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { AgentUpdate, DirectoryApi, WorkspaceUpdate } from "../client/directory-controller";
import type { FeedSubscription } from "../client/workspace-feed";

type Observer = Parameters<FeedSubscription["subscribe"]>[0];

export interface FakeFeed {
  id: string;
  observer: Observer | null;
}

export function agent(id: string, overrides: Partial<PaseoAgent> = {}): PaseoAgent {
  return {
    id,
    workspaceId: "ws-a",
    status: "idle",
    archivedAt: null,
    labels: {},
    pendingPermissions: [],
    ...overrides,
  } as unknown as PaseoAgent;
}

export function workspace(id: string, name: string): PaseoWorkspace {
  return { id, name } as unknown as PaseoWorkspace;
}

/**
 * A daemon behind the SDK's rules for directory listeners: `agents.subscribe` and
 * `workspaces.subscribe` handlers run only with the updates of an observation this
 * API opened itself with `list({ subscribe: {} })`. Nothing arrives otherwise.
 */
export function fakeDaemon() {
  const log: string[] = [];
  const agents = new Map<string, PaseoAgent>();
  const workspaces = new Map<string, PaseoWorkspace>();
  const agentListeners = new Set<(update: AgentUpdate) => void>();
  const workspaceListeners = new Set<(update: WorkspaceUpdate) => void>();
  const agentFeeds = new Set<FakeFeed>();
  const workspaceFeeds = new Set<FakeFeed>();
  let ids = 0;
  let failNextList: string | null = null;

  const openFeed = (feeds: Set<FakeFeed>, kind: string) => {
    const feed: FakeFeed = { id: `${kind}${++ids}`, observer: null };
    feeds.add(feed);
    const subscription: FeedSubscription = {
      subscribe(observer) {
        feed.observer = observer;
        observer.snapshot({ subscriptionId: feed.id });
        return () => {
          feed.observer = null;
        };
      },
      async release() {
        log.push(`release ${feed.id}`);
        feeds.delete(feed);
      },
    };
    return { subscriptionId: feed.id, subscription };
  };

  const api: DirectoryApi = {
    agents: {
      async list(options) {
        log.push(`agents.list${options.subscribe ? " subscribe" : ""}`);
        if (failNextList === "agents") {
          failNextList = null;
          throw new Error("agents down");
        }
        const page = {
          entries: [...agents.values()].map((entry) => ({ agent: entry })),
          pageInfo: { hasMore: false },
        };
        return options.subscribe ? { ...page, ...openFeed(agentFeeds, "a") } : page;
      },
      subscribe(handler) {
        agentListeners.add(handler);
        return () => agentListeners.delete(handler);
      },
    },
    workspaces: {
      async list(options: { page: { limit: number; cursor?: string }; subscribe?: {} }) {
        log.push(`workspaces.list${options.subscribe ? " subscribe" : ""}`);
        if (failNextList === "workspaces") {
          failNextList = null;
          throw new Error("workspaces down");
        }
        const page = { entries: [...workspaces.values()], pageInfo: { hasMore: false } };
        return options.subscribe ? { ...page, ...openFeed(workspaceFeeds, "w") } : page;
      },
      subscribe(handler) {
        workspaceListeners.add(handler);
        return () => workspaceListeners.delete(handler);
      },
    },
  };

  return {
    api,
    log,
    agents,
    workspaces,
    agentFeeds,
    workspaceFeeds,
    agentListeners,
    workspaceListeners,
    failNext(kind: "agents" | "workspaces") {
      failNextList = kind;
    },
    /** The daemon changed an agent; delivered only while an agent observation is open. */
    emitAgent(update: AgentUpdate) {
      if (update.kind !== "remove") agents.set(update.agent.id, update.agent);
      else agents.delete(update.agentId);
      if (agentFeeds.size === 0) return;
      for (const listener of agentListeners) listener(update);
    },
    /** The daemon changed a workspace; delivered only while a workspace observation is open. */
    emitWorkspace(entry: PaseoWorkspace, kind: "upsert" | "remove" = "upsert") {
      if (kind === "upsert") workspaces.set(entry.id, entry);
      else workspaces.delete(entry.id);
      if (workspaceFeeds.size === 0) return;
      const update = (kind === "upsert" ? { kind, workspace: entry } : { kind, workspaceId: entry.id }) as WorkspaceUpdate;
      for (const listener of workspaceListeners) listener(update);
    },
    /** The connection came back: the observation is set up again under a new id. */
    restore(feed: FakeFeed) {
      feed.id = `${feed.id}r`;
      feed.observer?.snapshot({ subscriptionId: feed.id });
    },
    /** The daemon dropped the observation; the SDK has released it. */
    fail(feed: FakeFeed, feeds: Set<FakeFeed>) {
      feeds.delete(feed);
      feed.observer?.error?.(new Error("gone"));
    },
  };
}
