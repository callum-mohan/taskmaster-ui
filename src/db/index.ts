import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { DATABASE_URL } from "astro:env/server";
import * as schema from "./schema";

/**
 * Drizzle over Neon's HTTP driver: each query is a single fetch, which suits
 * Cloudflare Workers (no TCP pool to keep warm). Multi-statement writes use
 * `db.batch([...])`, which runs as one non-interactive transaction. The
 * Node scripts in `db/` keep using the node-postgres client in `./client`.
 */
function createHttpDb() {
  return drizzle({ client: neon(DATABASE_URL), schema, casing: "snake_case" });
}

export type HttpDatabase = ReturnType<typeof createHttpDb>;

let cached: HttpDatabase | undefined;

/** Lazily created so the secret is read at request time, not module load. */
export function getDb(): HttpDatabase {
  return (cached ??= createHttpDb());
}
