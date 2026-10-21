/**
 * The one workspace observation for the whole plugin.
 *
 * `paseo.workspaces.subscribe(handler)` is a local listener: the SDK only calls it
 * with the `workspace_update` events of an observation this plugin opened itself
 * with `workspaces.list({ subscribe: {} })`, and the app's own observation does
 * not feed it. Without that call a listener never runs. Everyone who listens to
 * workspaces holds a share of this feed instead, and one daemon subscription
 * serves the header buttons and every open Lobby view.
 */

/** How long after the daemon dropped the observation before another is opened. */
export const WORKSPACE_FEED_RETRY_MS = 5 * 60_000;

export interface FeedSubscription {
  subscribe(observer: {
    snapshot(snapshot: { subscriptionId: string }): void;
    update(message: unknown): void;
    error?(error: unknown): void;
  }): () => void;
  release(): Promise<void>;
}

export interface WorkspaceFeedApi {
  workspaces: {
    list(options: { page: { limit: number }; subscribe: {} }): Promise<{
      subscriptionId?: string | null;
      subscription?: FeedSubscription;
    }>;
  };
}

export interface WorkspaceFeed {
  /**
   * Holds the feed open; `onRestored` runs when the observation was set up
   * again after the connection came back, because updates in between were not
   * kept. Returns the release.
   */
  acquire(onRestored: () => void): () => void;
  /** Whether a daemon observation is open right now. */
  open(): boolean;
}

export function createWorkspaceFeed(api: WorkspaceFeedApi, retryMs = WORKSPACE_FEED_RETRY_MS): WorkspaceFeed {
  const holders = new Set<() => void>();
  let feed: FeedSubscription | null = null;
  let opening = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const openFeed = () => {
    if (holders.size === 0 || feed || opening) return;
    opening = true;
    void api.workspaces
      .list({ page: { limit: 1 }, subscribe: {} })
      .then((result) => {
        const mine = result.subscription;
        if (!mine) return;
        if (holders.size === 0) {
          void mine.release().catch(() => {});
          return;
        }
        feed = mine;
        const first = result.subscriptionId;
        mine.subscribe({
          // The snapshot this call returned comes round once more here; any other is a restore.
          snapshot(snapshot) {
            if (snapshot.subscriptionId !== first) for (const holder of holders) holder();
          },
          update() {},
          // The SDK has released it; open another after the retry delay while somebody still holds.
          error() {
            if (feed !== mine) return;
            feed = null;
            if (holders.size > 0 && !retry) {
              retry = setTimeout(() => {
                retry = null;
                openFeed();
              }, retryMs);
            }
          },
        });
      })
      .catch(() => {
        if (holders.size > 0 && !retry) {
          retry = setTimeout(() => {
            retry = null;
            openFeed();
          }, retryMs);
        }
      })
      .finally(() => {
        opening = false;
      });
  };

  return {
    acquire(onRestored) {
      const holder = () => onRestored();
      holders.add(holder);
      openFeed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders.delete(holder);
        if (holders.size > 0) return;
        if (retry) clearTimeout(retry);
        retry = null;
        const mine = feed;
        feed = null;
        void mine?.release().catch(() => {});
      };
    },
    open: () => feed !== null,
  };
}

const feeds = new WeakMap<object, WorkspaceFeed>();

/** The feed for one plugin installation: the same `api` always gets the same feed. */
export function workspaceFeedFor(api: WorkspaceFeedApi): WorkspaceFeed {
  let feed = feeds.get(api);
  if (!feed) {
    feed = createWorkspaceFeed(api);
    feeds.set(api, feed);
  }
  return feed;
}
