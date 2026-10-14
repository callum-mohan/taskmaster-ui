/// <reference types="astro/client" />

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
