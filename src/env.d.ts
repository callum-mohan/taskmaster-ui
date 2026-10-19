/// <reference types="astro/client" />

// The Worker bindings this app uses (see `wrangler.jsonc`). Declared here
// rather than pulling in the full `@cloudflare/workers-types`.
declare module "cloudflare:workers" {
  interface RateLimiter {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  }
  export const env: {
    /** Throttles task reveal-password guesses (optional locally). */
    TASK_REVEAL_LIMITER?: RateLimiter;
    /** Throttles sign-in attempts per IP (optional locally). */
    LOGIN_LIMITER?: RateLimiter;
  };
}

declare namespace App {
  interface Locals {
    /**
     * Loads this request's competition snapshot (once, on first call) and
     * returns the selectors bound to it.
     */
    getQueries: () => Promise<import("./data/queries").Queries>;
    /** The signed-in admin; set by the middleware on `/admin` routes only. */
    admin?: import("./types").AdminUser;
    /** The signed-in player; set by the middleware on `/account` routes only. */
    player?: import("./types").SessionPlayer;
    /**
     * Who is signed in, for the navbar (looked up once, on first call, and
     * skipped entirely for visitors without a session cookie).
     */
    getViewer: () => Promise<import("./types").Viewer | undefined>;
  }
}
