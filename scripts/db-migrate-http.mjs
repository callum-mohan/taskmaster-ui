// Applies pending Drizzle migrations over Neon's HTTP driver (port 443), for
// networks where the direct Postgres connection `npm run db:migrate` uses
// (port 5432) is blocked. Records them in the same `drizzle.__drizzle_migrations`
// journal, so the two commands can be used interchangeably.
// Usage: npm run db:migrate:http  (loads .env.local via Node's --env-file)
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run `neon env pull` first.");
  process.exit(1);
}

const branch = process.env.NEON_BRANCH ?? "(unknown branch)";
console.log(`Applying migrations over HTTP to ${branch}…`);

try {
  await migrate(drizzle({ client: neon(connectionString) }), {
    migrationsFolder: "./drizzle",
  });
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
}
