import type { Player } from "../types";
import type { players as playersTable } from "../db/schema";

type PlayerRow = typeof playersTable.$inferSelect;

// The academy roster in roster order (which also breaks ties on equal
// points). Nullable columns are omitted rather than set to `null` so the
// `Player` shape is unchanged.
export function mapPlayers(rows: PlayerRow[]): Player[] {
  return rows.map((row) => ({
    id: row.id,
    seasonId: row.seasonId,
    name: row.name,
    ...(row.bio !== null && { bio: row.bio }),
    ...(row.avatarUrl !== null && { avatarUrl: row.avatarUrl }),
  }));
}
