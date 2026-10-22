import { describe, expect, it, vi } from "vitest";
import {
  cachedJson,
  cachedPage,
  purgeCached,
  type EdgeCache,
} from "./edge-cache";

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

describe("cachedPage", () => {
  const html = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, {
      headers: { "Content-Type": "text/html", ...headers },
    });

  it("renders and caches a page on a miss, then serves the cached copy", async () => {
    const { cache, entries } = memoryCache();
    const render = vi.fn(async () => html("<p>home</p>"));

    const first = await cachedPage(KEY, 60, render, cache);
    const second = await cachedPage(KEY, 60, render, cache);

    expect(await first.text()).toBe("<p>home</p>");
    expect(await second.text()).toBe("<p>home</p>");
    expect(render).toHaveBeenCalledTimes(1);
    expect(entries.get(KEY)?.headers.get("Cache-Control")).toBe("max-age=60");
    // Browsers never get the cache's lifetime.
    expect(first.headers.has("Cache-Control")).toBe(false);
    expect(second.headers.has("Cache-Control")).toBe(false);
    expect(second.headers.get("Content-Type")).toBe("text/html");
  });

  it.each([
    [
      "an error",
      () =>
        new Response("oops", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
    ],
    [
      "a redirect",
      () => new Response(null, { status: 302, headers: { Location: "/" } }),
    ],
    ["a cookie", () => html("<p>hi</p>", { "Set-Cookie": "a=b" })],
    [
      "its own Cache-Control",
      () => html("<p>live</p>", { "Cache-Control": "no-store" }),
    ],
    [
      "non-HTML",
      () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ],
  ])("doesn't cache a response with %s", async (_, make) => {
    const { cache, entries } = memoryCache();
    const response = make();

    expect(await cachedPage(KEY, 60, async () => response, cache)).toBe(
      response,
    );
    expect(entries.size).toBe(0);
  });

  it("renders every time without a cache", async () => {
    const render = vi.fn(async () => html("<p>home</p>"));

    await cachedPage(KEY, 60, render, undefined);
    await cachedPage(KEY, 60, render, undefined);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it("still serves the page when the cache fails", async () => {
    const broken: EdgeCache = {
      match: () => Promise.reject(new Error("down")),
      put: () => Promise.reject(new Error("down")),
      delete: () => Promise.reject(new Error("down")),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await cachedPage(
      KEY,
      60,
      async () => html("<p>home</p>"),
      broken,
    );

    expect(await response.text()).toBe("<p>home</p>");
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
