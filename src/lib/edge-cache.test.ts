import { describe, expect, it, vi } from "vitest";
import { cachedJson, purgeCached, type EdgeCache } from "./edge-cache";

/** An in-memory stand-in for `caches.default`. */
function memoryCache() {
  const entries = new Map<string, Response>();
  const cache: EdgeCache = {
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => {
      entries.set(key, response);
    },
    delete: async (key) => entries.delete(key),
  };
  return { cache, entries };
}

const KEY = "https://example.com/__cache/test";

describe("cachedJson", () => {
  it("loads and caches on a miss, then serves the cached copy", async () => {
    const { cache, entries } = memoryCache();
    const load = vi.fn(async () => ({ rows: [1, 2], at: "2026-01-01 00:00" }));

    const first = await cachedJson(KEY, 300, load, cache);
    const second = await cachedJson(KEY, 300, load, cache);

    expect(first).toEqual({ rows: [1, 2], at: "2026-01-01 00:00" });
    expect(second).toEqual(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(entries.get(KEY)?.headers.get("Cache-Control")).toBe("max-age=300");
  });

  it("loads every time without a cache", async () => {
    const load = vi.fn(async () => "fresh");

    await cachedJson(KEY, 300, load, undefined);
    await cachedJson(KEY, 300, load, undefined);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("falls back to loading when the cache fails", async () => {
    const broken: EdgeCache = {
      match: () => Promise.reject(new Error("down")),
      put: () => Promise.reject(new Error("down")),
      delete: () => Promise.reject(new Error("down")),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cachedJson(KEY, 300, async () => 42, broken)).resolves.toBe(
      42,
    );
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("doesn't cache a failed load", async () => {
    const { cache, entries } = memoryCache();

    await expect(
      cachedJson(KEY, 300, () => Promise.reject(new Error("db")), cache),
    ).rejects.toThrow("db");
    expect(entries.size).toBe(0);
  });
});

describe("purgeCached", () => {
  it("makes the next read load afresh", async () => {
    const { cache } = memoryCache();
    let version = 1;
    const load = async () => version;

    await cachedJson(KEY, 300, load, cache);
    version = 2;
    expect(await cachedJson(KEY, 300, load, cache)).toBe(1);

    await purgeCached(KEY, cache);
    expect(await cachedJson(KEY, 300, load, cache)).toBe(2);
  });

  it("swallows cache failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      delete: () => Promise.reject(new Error("down")),
    } as unknown as EdgeCache;

    await expect(purgeCached(KEY, broken)).resolves.toBeUndefined();
    error.mockRestore();
  });
});
