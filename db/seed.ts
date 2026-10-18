// Seeds an empty (or partially seeded) database with the initial competition
// data in `./seed-data.ts`. Inserts only rows that are missing, inside one
// transaction, so it is safe to re-run and never overwrites existing edits.
//
// Usage: npm run db:seed   (uses DATABASE_URL_UNPOOLED from .env.local)
import type { PgTable } from "drizzle-orm/pg-core";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import * as data from "./seed-data";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is not set. Run `neon env pull` first.");
  process.exit(1);
}

const { db, pool } = createDb(url);

try {
  const inserted = await db.transaction(async (tx) => {
    const insert = async <T extends PgTable>(
      table: T,
      rows: T["$inferInsert"][],
    ) =>
      rows.length === 0
        ? 0
        : (
            await tx
              .insert(table)
              .values(rows)
              .onConflictDoNothing()
              .returning()
          ).length;

    return {
      players: await insert(schema.players, data.players),
      teams: await insert(schema.teams, data.teams),
      team_members: await insert(schema.teamMembers, data.teamMembers),
      tasks: await insert(schema.tasks, data.tasks),
      task_scores: await insert(schema.taskScores, data.taskScores),
      team_scores: await insert(schema.teamScores, data.teamScores),
      // Bonus rows have generated ids, so only seed them into an empty table.
      bonus_points:
        (await tx.$count(schema.bonusPoints)) === 0
          ? await insert(schema.bonusPoints, data.bonusPoints)
          : 0,
      recaps: await insert(schema.recaps, data.recaps),
    };
  });
  console.log("Rows inserted (existing rows are left untouched):");
  console.table(inserted);
} catch (error) {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
