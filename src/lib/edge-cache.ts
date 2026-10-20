// A small JSON cache over Cloudflare's Cache API (`caches.default`). It's
// per data centre and needs no binding: entries expire on their own after
// their TTL, and `purgeCached` drops one early (in this data centre only).
// Wherever there's no Cache API (unit tests, `*.workers.dev`, where it's a
// no-op) values are simply loaded every time. A cache failure never fails
// the request: it falls back to loading.

/** The parts of the Workers `Cache` interface used here. */
export interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** The Worker's default cache, or `undefined` outside Cloudflare Workers. */
export function defaultEdgeCache(): EdgeCache | undefined {
  try {
    const storage = (globalThis as { caches?: { default?: EdgeCache } }).caches;
    return storage?.default;
  } catch {
    return undefined;
  }
}

/**
 * Returns the cached value for `key`, or loads it with `load` and caches it
 * for `ttlSeconds`. The value must survive a JSON round trip unchanged.
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  cache: EdgeCache | undefined = defaultEdgeCache(),
): Promise<T> {
  if (!cache) return load();
  try {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()) as T;
  } catch (error) {
    console.error(`Cache read ${key} failed`, error);
  }
  const value = await load();
  try {
    await cache.put(
      key,
      new Response(JSON.stringify(value), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${ttlSeconds}`,
        },
      }),
    );
  } catch (error) {
    console.error(`Cache write ${key} failed`, error);
  }
  return value;
}

/** Drops a cached value (best effort), so the next read loads it afresh. */
export async function purgeCached(
  key: string,
  cache: EdgeCache | undefined = defaultEdgeCache(),
): Promise<void> {
  if (!cache) return;
  try {
    await cache.delete(key);
  } catch (error) {
    console.error(`Cache purge ${key} failed`, error);
  }
}
