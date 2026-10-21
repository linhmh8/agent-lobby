import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFeed } from "../client/workspace-feed";
import { fakeDaemon } from "./fake-daemon";

const RETRY_MS = 1_000;
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("workspace feed", () => {
  it("opens one observation for every holder and releases it with the last", async () => {
    const daemon = fakeDaemon();
    const feed = createWorkspaceFeed(daemon.api, RETRY_MS);
    const releaseA = feed.acquire(() => {});
    const releaseB = feed.acquire(() => {});
    await settle();
    expect(daemon.log.filter((line) => line === "workspaces.list subscribe")).toHaveLength(1);
    expect(daemon.workspaceFeeds.size).toBe(1);
    expect(feed.open()).toBe(true);

    releaseA();
    await settle();
    expect(daemon.workspaceFeeds.size).toBe(1);
    releaseB();
    await settle();
    expect(daemon.workspaceFeeds.size).toBe(0);
    expect(feed.open()).toBe(false);
  });

  it("tells every holder when the observation was restored, not about its first snapshot", async () => {
    const daemon = fakeDaemon();
    const feed = createWorkspaceFeed(daemon.api, RETRY_MS);
    const restored: string[] = [];
    feed.acquire(() => restored.push("a"));
    feed.acquire(() => restored.push("b"));
    await settle();
    expect(restored).toEqual([]);
    daemon.restore([...daemon.workspaceFeeds][0]);
    expect(restored).toEqual(["a", "b"]);
  });

  it("opens another after the retry delay when the daemon dropped it, while somebody holds", async () => {
    const daemon = fakeDaemon();
    const feed = createWorkspaceFeed(daemon.api, RETRY_MS);
    const release = feed.acquire(() => {});
    await settle();
    daemon.fail([...daemon.workspaceFeeds][0], daemon.workspaceFeeds);
    expect(feed.open()).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(daemon.workspaceFeeds.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(daemon.workspaceFeeds.size).toBe(1);
    expect(feed.open()).toBe(true);

    daemon.fail([...daemon.workspaceFeeds][0], daemon.workspaceFeeds);
    release();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(daemon.workspaceFeeds.size).toBe(0);
  });

  it("retries a list call that failed", async () => {
    const daemon = fakeDaemon();
    daemon.failNext("workspaces");
    const feed = createWorkspaceFeed(daemon.api, RETRY_MS);
    feed.acquire(() => {});
    await settle();
    expect(feed.open()).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(feed.open()).toBe(true);
  });

  it("lets go of an observation that arrived after the last release", async () => {
    const daemon = fakeDaemon();
    const feed = createWorkspaceFeed(daemon.api, RETRY_MS);
    const release = feed.acquire(() => {});
    release();
    await settle();
    expect(daemon.workspaceFeeds.size).toBe(0);
    expect(feed.open()).toBe(false);
  });
});
