// Loads the right season's selectors for a page about one record (a week,
// a player or a squad), wherever its season sits in the archive.
import type { Queries } from "../data/queries";
import { isSeasonPublic } from "../data/seasons";
import type { Season } from "../types";

type SeasonLocals = Pick<App.Locals, "getQueries" | "getSeasons">;

export type SeasonRecord = "task" | "player" | "team";

export interface RecordScope {
  season: Season;
  queries: Queries;
}

/**
 * The season `id` belongs to and its selectors, or `undefined` when there's
 * no such record, or it's in a season the public can't see yet (one being
 * prepared) and the viewer isn't an admin. Pages answer `undefined` with
 * a 404.
 */
export async function recordScope(
  locals: SeasonLocals,
  kind: SeasonRecord,
  id: string | undefined,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): Promise<RecordScope | undefined> {
  if (id === undefined) return undefined;
  const seasons = await locals.getSeasons();
  const season = {
    task: seasons.seasonOfTask,
    player: seasons.seasonOfPlayer,
    team: seasons.seasonOfTeam,
  }[kind](id);
  if (!season || (!isAdmin && !isSeasonPublic(season))) return undefined;
  return { season, queries: await locals.getQueries(season.id) };
}

/**
 * The selectors for the season a week is in (the current season's for an
 * unknown week, which then simply isn't found). For endpoints acting on a
 * week; pages showing one use `recordScope`.
 */
export async function queriesForTask(
  locals: SeasonLocals,
  taskId: string | undefined,
): Promise<Queries> {
  const season =
    taskId === undefined
      ? undefined
      : (await locals.getSeasons()).seasonOfTask(taskId);
  return locals.getQueries(season?.id);
}
