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
  }
}
