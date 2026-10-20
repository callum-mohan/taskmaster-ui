import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { withVerifiedSsl } from "./url";

/**
 * Creates a Drizzle client over a node-postgres pool for the Node scripts in
 * `db/` (seeding, checks), which each supply their own connection string. The
 * site itself uses the Workers-friendly HTTP client in `./index.ts`.
 */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: withVerifiedSsl(connectionString),
    max: 5,
    // Let the build / script exit once queries finish instead of waiting
    // for idle connections to time out.
    allowExitOnIdle: true,
  });
  return {
    db: drizzle({ client: pool, schema, casing: "snake_case" }),
    pool,
  };
}

export type Database = ReturnType<typeof createDb>["db"];
