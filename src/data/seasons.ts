import type { Season, SeasonDirectory, SeasonStatus } from "../types";
import type {
  players as playersTable,
  seasons as seasonsTable,
  tasks as tasksTable,
  teams as teamsTable,
} from "../db/schema";
import { timestamptzToIso, wallClockToIso } from "../lib/time";
import type { CompetitionRows } from "./competition";

type SeasonRow = typeof seasonsTable.$inferSelect;
type SeasonTaskRow = Pick<
  typeof tasksTable.$inferSelect,
  "id" | "seasonId" | "releaseDate" | "deadline"
>;
type SeasonMemberRow = Pick<
  typeof playersTable.$inferSelect | typeof teamsTable.$inferSelect,
  "id" | "seasonId"
>;

/**
 * Derives a season's status from whether it was closed and its weeks'
 * release dates, so it moves from "upcoming" to "running" by itself.
 */
export function deriveSeasonStatus(
  season: { closedAt?: string; startsAt?: string },
  now: number = Date.now(),
): SeasonStatus {
  if (season.closedAt) return "closed";
  if (season.startsAt && new Date(season.startsAt).getTime() <= now) {
    return "running";
  }
  return "upcoming";
}

/** Every season, oldest first, with its schedule bounds and status. */
export function mapSeasons(
  rows: SeasonRow[],
  taskRows: SeasonTaskRow[],
  now: number = Date.now(),
): Season[] {
  return [...rows]
    .sort(
      (a, b) =>
        new Date(timestamptzToIso(a.createdAt)).getTime() -
          new Date(timestamptzToIso(b.createdAt)).getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((row) => {
      const weeks = taskRows.filter((task) => task.seasonId === row.id);
      const releases = weeks.map((t) => wallClockToIso(t.releaseDate)).sort();
      const deadlines = weeks.map((t) => wallClockToIso(t.deadline)).sort();
      const bounds = {
        ...(row.closedAt !== null && {
          closedAt: timestamptzToIso(row.closedAt),
        }),
        ...(releases.length > 0 && { startsAt: releases[0] }),
        ...(deadlines.length > 0 && { endsAt: deadlines.at(-1) }),
      };
      return {
        id: row.id,
        name: row.name,
        isCurrent: row.isCurrent,
        createdAt: timestamptzToIso(row.createdAt),
        ...bounds,
        status: deriveSeasonStatus(bounds, now),
        weekCount: weeks.length,
      };
    });
}

/** Looks up seasons, and which season a player, squad or week is in. */
export function createSeasonDirectory(
  seasons: Season[],
  rows: {
    players: SeasonMemberRow[];
    teams: SeasonMemberRow[];
    tasks: SeasonMemberRow[];
  },
): SeasonDirectory {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const index = (members: SeasonMemberRow[]) =>
    new Map(members.map((m) => [m.id, m.seasonId]));
  const playerSeason = index(rows.players);
  const teamSeason = index(rows.teams);
  const taskSeason = index(rows.tasks);
  const lookup = (map: Map<string, string>) => (id: string) => {
    const seasonId = map.get(id);
    return seasonId === undefined ? undefined : byId.get(seasonId);
  };
  return {
    seasons,
    current: seasons.find((s) => s.isCurrent),
    getSeason: (id) => byId.get(id),
    seasonOfPlayer: lookup(playerSeason),
    seasonOfTeam: lookup(teamSeason),
    seasonOfTask: lookup(taskSeason),
  };
}

/**
 * Whether the public may see a season: the current one, and any closed one
 * (the archive). Seasons being prepared stay admin-only.
 */
export function isSeasonPublic(season: Season): boolean {
  return season.isCurrent || season.status === "closed";
}

/**
 * Whether a season's "wrapped" is live for the public: once it's closed and
 * its champion crowned. Admins can preview it before then.
 */
export function isWrappedLive(season: Season): boolean {
  return season.status === "closed";
}

/**
 * Narrows every row to one season: its roster, squads and weeks, and the
 * scores, bonuses, votes, predictions, recaps and Clim Coin records for
 * those weeks and players. Polls, the changelog and the shop are site-wide; a poll's vote bonus only counts when it lands
 * in one of the season's weeks and the voter is on its roster.
 */
export function rowsForSeason(
  rows: CompetitionRows,
  seasonId: string,
): CompetitionRows {
  const inSeason = <Row extends { seasonId: string }>(list: Row[]) =>
    list.filter((row) => row.seasonId === seasonId);
  const taskRows = inSeason(rows.taskRows);
  const taskIds = new Set(taskRows.map((row) => row.id));
  const playerRows = inSeason(rows.playerRows);
  const playerIds = new Set(playerRows.map((row) => row.id));
  const forWeeks = <Row extends { taskId: string }>(list: Row[]) =>
    list.filter((row) => taskIds.has(row.taskId));
  // Only the season's own players vote and predict on its weeks.
  const bySeasonPlayers = <Row extends { taskId: string; playerId: string }>(
    list: Row[],
  ) => forWeeks(list).filter((row) => playerIds.has(row.playerId));
  const forPlayers = <Row extends { playerId: string }>(list: Row[]) =>
    list.filter((row) => playerIds.has(row.playerId));
  const marketListingRows = inSeason(rows.marketListingRows);
  const listingIds = new Set(marketListingRows.map((row) => row.id));
  return {
    ...rows,
    playerRows,
    teamRows: inSeason(rows.teamRows),
    memberRows: inSeason(rows.memberRows),
    taskRows,
    taskScoreRows: forWeeks(rows.taskScoreRows),
    teamScoreRows: forWeeks(rows.teamScoreRows),
    bonusRows: forWeeks(rows.bonusRows),
    peoplesChoiceRows: bySeasonPlayers(rows.peoplesChoiceRows),
    predictionRows: bySeasonPlayers(rows.predictionRows),
    recapRows: forWeeks(rows.recapRows),
    // Wallets are per season: the season's players' purchases, uses on its
    // weeks, equipped items, grants, item and egg gifts, wishes and skill trees. The catalogue is site-wide.
    coinPurchaseRows: forPlayers(rows.coinPurchaseRows),
    powerUpUseRows: bySeasonPlayers(rows.powerUpUseRows),
    equippedRows: forPlayers(rows.equippedRows),
    coinAdjustmentRows: forPlayers(rows.coinAdjustmentRows),
    entryRows: bySeasonPlayers(rows.entryRows),
    crateOpenRows: forPlayers(rows.crateOpenRows),
    coinGiftRows: inSeason(rows.coinGiftRows),
    itemGiftRows: forPlayers(rows.itemGiftRows),
    eggGiftRows: forPlayers(rows.eggGiftRows),
    wishRows: forPlayers(rows.wishRows),
    skillPathRows: forPlayers(rows.skillPathRows),
    skillUnlockRows: forPlayers(rows.skillUnlockRows),
    miniTaskRows: inSeason(rows.miniTaskRows),
    miniTaskCompletionRows: inSeason(rows.miniTaskCompletionRows),
    // The marketplace is per season too: offers go with their listing.
    marketListingRows,
    marketOfferRows: rows.marketOfferRows.filter((row) =>
      listingIds.has(row.listingId),
    ),
    marketSaleRows: inSeason(rows.marketSaleRows),
  };
}
