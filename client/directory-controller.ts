import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "./paseo-types";
import type { FeedSubscription, WorkspaceFeed } from "./workspace-feed";

const PAGE_LIMIT = 200;
const MAX_PAGES = 10;
/**
 * The list subscription carries every change while the connection holds, and
 * says when it has been restored after a break: that is when updates can have
 * been lost (nothing is replayed), and everything is loaded again then. This
 * timer is only the last resort behind that: agents again, and the
 * subscription itself again if it failed, every five minutes.
 */
export const BACKSTOP_MS = 5 * 60_000;
export const WORKSPACE_DEBOUNCE_MS = 500;

export type AgentUpdate = Parameters<Parameters<PaseoApi["agents"]["subscribe"]>[0]>[0];
export type WorkspaceUpdate = Parameters<Parameters<PaseoApi["workspaces"]["subscribe"]>[0]>[0];

interface Page<Entry> {
  entries: Entry[];
  pageInfo: { hasMore: boolean; nextCursor?: string | null };
  subscriptionId?: string | null;
  subscription?: FeedSubscription;
}

/** What the controller needs of `PaseoApi`; a fake daemon in a test provides the same. */
export interface DirectoryApi {
  agents: {
    list(options: {
      filter: { includeArchived: boolean };
      sort?: { key: "updated_at"; direction: "desc" }[];
      page: { limit: number; cursor?: string };
      subscribe?: {};
    }): Promise<Page<{ agent: PaseoAgent }>>;
    subscribe(handler: (update: AgentUpdate) => void): () => void;
  };
  workspaces: {
    list(options: { page: { limit: number; cursor?: string } }): Promise<Page<PaseoWorkspace>>;
    subscribe(handler: (update: WorkspaceUpdate) => void): () => void;
  };
}

/** Where the controller reports what the view draws. */
export interface DirectorySink {
  agents(agents: ReadonlyMap<string, PaseoAgent>): void;
  workspaces(workspaces: ReadonlyMap<string, PaseoWorkspace>): void;
  phase(phase: "loading" | "ready" | "error"): void;
  error(error: string | null): void;
  truncated(truncated: boolean): void;
}

export interface DirectoryController {
  /** Loads everything, then follows live updates until `stop`. */
  start(): void;
  /** Loads agents and workspaces again. */
  reload(): void;
  /** Lets go of everything; nothing is reported after. */
  stop(): void;
}

export interface DirectoryOptions {
  backstopMs?: number;
  workspaceDebounceMs?: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchAgents(
  api: DirectoryApi,
): Promise<{ agents: Map<string, PaseoAgent>; truncated: boolean }> {
  const agents = new Map<string, PaseoAgent>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.agents.list({
      filter: { includeArchived: false },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    for (const entry of result.entries) agents.set(entry.agent.id, entry.agent);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return { agents, truncated: false };
    cursor = result.pageInfo.nextCursor;
  }
  return { agents, truncated: true };
}

export async function fetchWorkspaces(api: DirectoryApi): Promise<Map<string, PaseoWorkspace>> {
  const workspaces = new Map<string, PaseoWorkspace>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.workspaces.list({
      page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    for (const workspace of result.entries) workspaces.set(workspace.id, workspace);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return workspaces;
}

/**
 * One full load, then live `agent_update` events from one list subscription
 * applied in place. Workspaces come from the plugin-wide feed and are read again
 * on each change. The backstop refetch only guards against a missed event; it is
 * not the feed.
 */
export function createDirectoryController(
  api: DirectoryApi,
  workspaceFeed: WorkspaceFeed,
  sink: DirectorySink,
  options: DirectoryOptions = {},
): DirectoryController {
  const backstopMs = options.backstopMs ?? BACKSTOP_MS;
  const debounceMs = options.workspaceDebounceMs ?? WORKSPACE_DEBOUNCE_MS;

  let alive = false;
  let agents: Map<string, PaseoAgent> = new Map();
  let workspaces: Map<string, PaseoWorkspace> = new Map();
  let phase: "loading" | "ready" | "error" = "loading";
  let generation = 0;
  // Workspaces asked about after an agent in one nobody had told us about turned up.
  const asked = new Set<string>();

  let feed: FeedSubscription | null = null;
  let opening = false;
  let workspaceTimer: ReturnType<typeof setTimeout> | null = null;
  let backstop: ReturnType<typeof setInterval> | null = null;
  let stopAgents: (() => void) | null = null;
  let stopWorkspaces: (() => void) | null = null;
  let releaseWorkspaceFeed: (() => void) | null = null;

  const showAgents = (next: Map<string, PaseoAgent>) => {
    if (next === agents) return;
    agents = next;
    if (alive) sink.agents(next);
  };
  const showWorkspaces = (next: Map<string, PaseoWorkspace>) => {
    workspaces = next;
    if (alive) sink.workspaces(next);
  };
  const showPhase = (next: typeof phase) => {
    phase = next;
    if (alive) sink.phase(next);
  };

  const reload = () => {
    const run = ++generation;
    void (async () => {
      try {
        const [loaded, loadedWorkspaces] = await Promise.all([fetchAgents(api), fetchWorkspaces(api)]);
        if (run !== generation || !alive) return;
        showAgents(keepKnown(agents, loaded.agents));
        showWorkspaces(loadedWorkspaces);
        sink.truncated(loaded.truncated);
        sink.error(null);
        showPhase("ready");
      } catch (cause) {
        if (run !== generation || !alive) return;
        sink.error(message(cause));
        showPhase(phase === "ready" ? "ready" : "error");
      }
    })();
  };

  const refreshWorkspaces = () => {
    if (workspaceTimer) clearTimeout(workspaceTimer);
    workspaceTimer = setTimeout(() => {
      workspaceTimer = null;
      void fetchWorkspaces(api)
        .then((loaded) => {
          if (alive) showWorkspaces(loaded);
        })
        .catch(() => {});
    }, debounceMs);
  };

  // `agents.subscribe` only hears what a subscribing list call brings in: without one, no
  // `agent_update` arrives at all. The page is irrelevant, the subscription follows the filter.
  const openFeed = () => {
    if (!alive || feed || opening) return;
    opening = true;
    void api.agents
      .list({ filter: { includeArchived: false }, page: { limit: 1 }, subscribe: {} })
      .then((result) => {
        const mine = result.subscription;
        if (!mine) return;
        if (!alive) {
          void mine.release().catch(() => {});
          return;
        }
        feed = mine;
        const first = result.subscriptionId;
        mine.subscribe({
          // The snapshot this call returned comes round once more here. Any other is the subscription
          // set up again after the connection came back: updates sent in between were not kept.
          snapshot(snapshot) {
            if (snapshot.subscriptionId !== first) reload();
          },
          update() {},
          // The SDK has released it; the backstop opens another.
          error() {
            if (feed === mine) feed = null;
          },
        });
      })
      .catch(() => {})
      .finally(() => {
        opening = false;
      });
  };

  const onAgent = (update: AgentUpdate) => {
    const next = new Map(agents);
    if (update.kind === "remove") {
      if (next.delete(update.agentId)) showAgents(next);
      return;
    }
    if (update.agent.archivedAt) {
      if (next.delete(update.agent.id)) showAgents(next);
      return;
    }
    next.set(update.agent.id, update.agent);
    showAgents(next);
    // An agent in a workspace nobody has told us about: its event was missed, so ask, once for each.
    const workspaceId = update.agent.workspaceId;
    if (workspaceId && !workspaces.has(workspaceId) && !asked.has(workspaceId)) {
      asked.add(workspaceId);
      refreshWorkspaces();
    }
  };

  return {
    start() {
      if (alive) return;
      alive = true;
      reload();
      stopAgents = api.agents.subscribe(onAgent);
      openFeed();
      stopWorkspaces = api.workspaces.subscribe(refreshWorkspaces);
      releaseWorkspaceFeed = workspaceFeed.acquire(refreshWorkspaces);
      backstop = setInterval(() => {
        openFeed();
        const run = generation;
        void fetchAgents(api)
          .then((loaded) => {
            // A reload since then has newer news.
            if (run !== generation || !alive) return;
            showAgents(keepKnown(agents, loaded.agents));
            sink.truncated(loaded.truncated);
          })
          .catch(() => {});
      }, backstopMs);
    },
    reload() {
      if (alive) reload();
    },
    stop() {
      if (!alive) return;
      alive = false;
      generation += 1;
      const mine = feed;
      feed = null;
      void mine?.release().catch(() => {});
      stopAgents?.();
      stopAgents = null;
      stopWorkspaces?.();
      stopWorkspaces = null;
      releaseWorkspaceFeed?.();
      releaseWorkspaceFeed = null;
      if (workspaceTimer) clearTimeout(workspaceTimer);
      workspaceTimer = null;
      if (backstop) clearInterval(backstop);
      backstop = null;
    },
  };
}

/**
 * A refetch brings every agent as a new object. Whoever reads the same as
 * before keeps the object it had, and a refetch that brought nothing new keeps
 * the whole map, so that it draws nothing.
 */
export function keepKnown(before: Map<string, PaseoAgent>, after: Map<string, PaseoAgent>): Map<string, PaseoAgent> {
  let same = before.size === after.size;
  const out = new Map<string, PaseoAgent>();
  for (const [id, agent] of after) {
    const known = before.get(id);
    const kept = known && JSON.stringify(known) === JSON.stringify(agent) ? known : agent;
    if (kept !== known) same = false;
    out.set(id, kept);
  }
  return same ? before : out;
}
