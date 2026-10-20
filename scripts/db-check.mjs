// Verifies the Neon connection in DATABASE_URL by running a real query.
// Usage: npm run db:check  (loads .env.local via Node's --env-file)
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run `neon env pull` first.");
  process.exit(1);
}

const client = new pg.Client({
  // Pin verify-full (pg 8's current behaviour for `require`); see src/db/url.ts.
  connectionString: connectionString.replace(
    /sslmode=(prefer|require|verify-ca)/,
    "sslmode=verify-full",
  ),
});

try {
  await client.connect();
  const { rows } = await client.query(`
    select
      current_database() as database,
      current_user as "user",
      split_part(version(), ' on ', 1) as version,
      now() as server_time,
      (select count(*)::int from information_schema.tables
         where table_schema = 'public') as public_tables
  `);
  console.table(rows);
} catch (error) {
  console.error("Database check failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
