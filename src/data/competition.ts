import { asc, desc, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type {
  CompetitionData,
  Season,
  SeasonDirectory,
  TaskRevealContext,
} from "../types";
import { getDb } from "../db";
import {
  bonusPoints as bonusPointsTable,
  changelogEntries as changelogTable,
  coinAdjustments as coinAdjustmentsTable,
  coinGifts as coinGiftsTable,
  coinPurchases as coinPurchasesTable,
  crateOpens as crateOpensTable,
  equippedItems as equippedItemsTable,
  featureFlags as featureFlagsTable,
  itemGifts as itemGiftsTable,
  marketListings as marketListingsTable,
  marketOffers as marketOffersTable,
  marketSales as marketSalesTable,
  miniTaskCompletions as miniTaskCompletionsTable,
  miniTasks as miniTasksTable,
  wishes as wishesTable,
  powerUpUses as powerUpUsesTable,
  shopItems as shopItemsTable,
  skillPaths as skillPathsTable,
  skillUnlocks as skillUnlocksTable,
  peoplesChoiceVotes as peoplesChoiceVotesTable,
  players as playersTable,
  pollOptions as pollOptionsTable,
  polls as pollsTable,
  pollVotes as pollVotesTable,
  predictions as predictionsTable,
  recaps as recapsTable,
  seasons as seasonsTable,
  taskScores as taskScoresTable,
  taskSubmissions as taskSubmissionsTable,
  tasks as tasksTable,
  teamMembers as teamMembersTable,
  teamScores as teamScoresTable,
  teams as teamsTable,
} from "../db/schema";
import { mapPlayers } from "./players";
import { mapTeams } from "./teams";
import { mapTasks } from "./tasks";
import { buildScoreRecords } from "./scores";
import { derivePollBonusRows, mapPolls } from "./polls";
import {
  derivePeoplesChoiceBonusRows,
  mapPeoplesChoiceVotes,
} from "./peoples-choice";
import { derivePredictionBonusRows, mapPredictions } from "./predictions";
import { mapChangelog, mapRecaps } from "./editorial";
import { createSeasonDirectory, mapSeasons, rowsForSeason } from "./seasons";
import {
  deriveSabotageBonusRows,
  mapAdjustments,
  mapCrateOpens,
  mapEntries,
  mapEquipped,
  mapGifts,
  mapHints,
  mapItemGifts,
  mapWishes,
  mapPowerUpUses,
  mapPurchases,
  mapShopItems,
  mapSkillPaths,
  mapSkillUnlocks,
  powerUpKeys,
  resolveSabotages,
} from "./coins";
import { mapFeatureFlags } from "./feature-flags";
import { mapMarket } from "./market-mappers";
import { mapMiniTaskCompletions, mapMiniTasks } from "./mini-tasks";
import { unlockedTaskIds } from "../lib/task-reveal";
import { timestamptzToIso } from "../lib/time";
import { cachedJson, purgeCached } from "../lib/edge-cache";

/**
 * Who the snapshot is for: public visitors (with any task reveal cookies
 * they carry, keyed by task id) or an admin, who always sees real content.
 */
export type CompetitionViewer =
  | { mode: "public"; revealTokens: ReadonlyMap<string, string> }
  | { mode: "admin" };

// The raw rows are the same for every viewer (reveal cookies, admin mode and
// held results are applied after loading), so public requests share one
// copy cached per Cloudflare data centre. Data only changes through writes,
// and every signed-in write purges it (see `src/middleware.ts`), so the TTL
// only bounds how stale other data centres and script/console edits can be.
const ROWS_CACHE_TTL_SECONDS = 5 * 60;

/**
 * The cache key for the raw rows. It includes the deployed Worker version so
 * a deploy (whose code may expect a new column) never reads rows cached by
 * the previous one. The path isn't a route, and the Worker runs before the
 * cache, so the entry can't be fetched from outside.
 */
const rowsCacheKey = (origin: string) =>
  `${origin}/__cache/competition-rows/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

// Signed-out visitors' pages are cached under the current generation (see
// `src/middleware.ts`). Purging it with the rows moves every page in this
// data centre onto fresh keys, since a URL-keyed cache can't be emptied.
const generationCacheKey = (origin: string) =>
  `${origin}/__cache/competition-generation/${
    env.CF_VERSION_METADATA?.id ?? "local"
  }`;

/**
 * The current generation of the cached competition data (in this data
 * centre): it changes whenever the cached rows are purged or expire. Cache
 * keys that include it are dropped along with the rows.
 */
export const competitionCacheGeneration = (origin: string) =>
  cachedJson<string>(
    generationCacheKey(origin),
    ROWS_CACHE_TTL_SECONDS,
    async () => `${env.CF_VERSION_METADATA?.id ?? "local"}-${Date.now()}`,
  );

/** Drops the cached rows (and pages built from them) in this data centre. */
export const invalidateCompetitionCache = async (origin: string) => {
  await Promise.all([
    purgeCached(rowsCacheKey(origin)),
    purgeCached(generationCacheKey(origin)),
  ]);
};

/** Every competition table's rows, in one HTTP round trip. */
async function fetchCompetitionRows() {
  const db = getDb();
  const [
    seasonRows,
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
    shopItemRows,
    coinPurchaseRows,
    powerUpUseRows,
    equippedRows,
    coinAdjustmentRows,
    entryRows,
    crateOpenRows,
    coinGiftRows,
    featureFlagRows,
    itemGiftRows,
    wishRows,
    skillPathRows,
    skillUnlockRows,
    miniTaskRows,
    miniTaskCompletionRows,
    marketListingRows,
    marketOfferRows,
    marketSaleRows,
  ] = await db.batch([
    db.select().from(seasonsTable),
    db.select().from(playersTable).orderBy(asc(playersTable.sortOrder)),
    db.select().from(teamsTable).orderBy(asc(teamsTable.sortOrder)),
    db
      .select()
      .from(teamMembersTable)
      .orderBy(asc(teamMembersTable.teamId), asc(teamMembersTable.sortOrder)),
    db.select().from(tasksTable).orderBy(asc(tasksTable.weekNumber)),
    db.select().from(taskScoresTable),
    db.select().from(teamScoresTable),
    db.select().from(bonusPointsTable).orderBy(asc(bonusPointsTable.id)),
    db
      .select()
      .from(pollsTable)
      .orderBy(desc(pollsTable.opensAt), desc(pollsTable.createdAt)),
    db.select().from(pollOptionsTable),
    db.select().from(pollVotesTable),
    // Each vote with the entry's owner, so winners resolve without loading
    // every submission.
    db
      .select({
        taskId: peoplesChoiceVotesTable.taskId,
        playerId: peoplesChoiceVotesTable.playerId,
        submissionId: peoplesChoiceVotesTable.submissionId,
        submitterId: taskSubmissionsTable.playerId,
        teamId: taskSubmissionsTable.teamId,
        hiddenAt: taskSubmissionsTable.hiddenAt,
      })
      .from(peoplesChoiceVotesTable)
      .innerJoin(
        taskSubmissionsTable,
        eq(taskSubmissionsTable.id, peoplesChoiceVotesTable.submissionId),
      ),
    db.select().from(predictionsTable).orderBy(asc(predictionsTable.createdAt)),
    db.select().from(recapsTable),
    db
      .select()
      .from(changelogTable)
      .orderBy(desc(changelogTable.date), desc(changelogTable.createdAt)),
    db.select().from(shopItemsTable),
    db.select().from(coinPurchasesTable).orderBy(asc(coinPurchasesTable.id)),
    db.select().from(powerUpUsesTable).orderBy(asc(powerUpUsesTable.id)),
    db.select().from(equippedItemsTable),
    db
      .select()
      .from(coinAdjustmentsTable)
      .orderBy(asc(coinAdjustmentsTable.id)),
    // Who entered which week (visible entries only), for the entry payout.
    db
      .selectDistinct({
        taskId: taskSubmissionsTable.taskId,
        playerId: taskSubmissionsTable.playerId,
      })
      .from(taskSubmissionsTable)
      .where(isNull(taskSubmissionsTable.hiddenAt)),
    db.select().from(crateOpensTable).orderBy(asc(crateOpensTable.id)),
    db.select().from(coinGiftsTable).orderBy(asc(coinGiftsTable.id)),
    db.select().from(featureFlagsTable),
    db.select().from(itemGiftsTable).orderBy(asc(itemGiftsTable.id)),
    db.select().from(wishesTable).orderBy(asc(wishesTable.id)),
    db.select().from(skillPathsTable),
    db.select().from(skillUnlocksTable).orderBy(asc(skillUnlocksTable.id)),
    db.select().from(miniTasksTable),
    db.select().from(miniTaskCompletionsTable),
    db.select().from(marketListingsTable),
    db.select().from(marketOffersTable),
    db.select().from(marketSalesTable),
  ]);
  return {
    seasonRows,
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
    shopItemRows,
    coinPurchaseRows,
    powerUpUseRows,
    equippedRows,
    coinAdjustmentRows,
    entryRows,
    crateOpenRows,
    coinGiftRows,
    featureFlagRows,
    itemGiftRows,
    wishRows,
    skillPathRows,
    skillUnlockRows,
    miniTaskRows,
    miniTaskCompletionRows,
    marketListingRows,
    marketOfferRows,
    marketSaleRows,
  };
}

export type CompetitionRows = Awaited<ReturnType<typeof fetchCompetitionRows>>;

/**
 * Every competition table's rows for the current request. Admins always read
 * the database directly; public requests (given the site `origin` for the
 * cache key) share the cached rows. Build a season's snapshot from them with
 * `buildCompetition`.
 */
export async function loadCompetitionRows(
  viewer: CompetitionViewer = { mode: "public", revealTokens: new Map() },
  cacheOrigin?: string,
): Promise<CompetitionRows> {
  return viewer.mode === "admin" || !cacheOrigin
    ? fetchCompetitionRows()
    : cachedJson<CompetitionRows>(
        rowsCacheKey(cacheOrigin),
        ROWS_CACHE_TTL_SECONDS,
        fetchCompetitionRows,
      );
}

/**
 * The snapshot of the season `playerId` is in, built from rows read straight
 * from the database (skipping the edge cache), or `undefined` for an
 * unknown player. For checks guarding a write that mustn't act on stale
 * rows, e.g. a Clim Coin balance before a purchase.
 */
export async function loadFreshPlayerCompetition(
  playerId: string,
): Promise<CompetitionData | undefined> {
  const rows = await fetchCompetitionRows();
  const season = buildSeasonDirectory(rows).seasonOfPlayer(playerId);
  if (!season) return undefined;
  return buildCompetition(
    rows,
    { mode: "public", revealTokens: new Map() },
    season,
  );
}

/** The seasons, and which season each player, squad and week is in. */
export function buildSeasonDirectory(rows: CompetitionRows): SeasonDirectory {
  return createSeasonDirectory(mapSeasons(rows.seasonRows, rows.taskRows), {
    players: rows.playerRows,
    teams: rows.teamRows,
    tasks: rows.taskRows,
  });
}

/**
 * Maps one season's rows onto the `src/types` shapes for `viewer`. Derived
 * state (task status, deadlines) is worked out on every request, so it's
 * never stale.
 */
export async function buildCompetition(
  allRows: CompetitionRows,
  viewer: CompetitionViewer,
  season: Season,
): Promise<CompetitionData> {
  return buildSeasonCompetition(
    rowsForSeason(allRows, season.id),
    viewer,
    season,
  );
}

async function buildSeasonCompetition(
  {
    playerRows,
    teamRows,
    memberRows,
    taskRows,
    taskScoreRows,
    teamScoreRows,
    bonusRows,
    pollRows,
    pollOptionRows,
    pollVoteRows,
    peoplesChoiceRows,
    predictionRows,
    recapRows,
    changelogRows,
    shopItemRows,
    coinPurchaseRows,
    powerUpUseRows,
    equippedRows,
    coinAdjustmentRows,
    entryRows,
    crateOpenRows,
    coinGiftRows,
    featureFlagRows,
    itemGiftRows,
    wishRows,
    skillPathRows,
    skillUnlockRows,
    miniTaskRows,
    miniTaskCompletionRows,
    marketListingRows,
    marketOfferRows,
    marketSaleRows,
  }: CompetitionRows,
  viewer: CompetitionViewer,
  season: Season,
): Promise<CompetitionData> {
  const players = mapPlayers(playerRows);
  const teams = mapTeams(teamRows, memberRows);
  const reveal: TaskRevealContext =
    viewer.mode === "admin"
      ? viewer
      : {
          mode: "public",
          unlockedTaskIds: await unlockedTaskIds(
            viewer.revealTokens,
            new Map(
              taskRows.flatMap((row) =>
                row.revealPassword ? [[row.id, row.revealPassword]] : [],
              ),
            ),
          ),
        };
  const tasks = mapTasks(taskRows, reveal);
  const polls = mapPolls(pollRows, pollOptionRows, pollVoteRows, tasks);
  const peoplesChoiceVotes = mapPeoplesChoiceVotes(peoplesChoiceRows);
  const predictions = mapPredictions(predictionRows);

  // Results night: the public never sees a held week's scores or recorded
  // bonuses (they go out one at a time on `/live`); admins always do.
  const heldTaskIds = new Set(
    viewer.mode === "admin"
      ? []
      : taskRows.filter((row) => row.resultsHeldAt !== null).map((r) => r.id),
  );
  const published = <Row extends { taskId: string }>(rows: Row[]) =>
    rows.filter((row) => !heldTaskIds.has(row.taskId));
  const publishedAt = Object.fromEntries(
    taskRows.flatMap((row) =>
      row.resultsPublishedAt ? [[row.id, row.resultsPublishedAt]] : [],
    ),
  );

  const scoreRows = {
    taskScores: published(taskScoreRows),
    teamScores: published(teamScoreRows),
  };
  // Clim Coin power-ups: Golden Week boosts task points before ranking,
  // Double Down raises a correct call's bonus and Sabotage is a deduction.
  const uses = mapPowerUpUses(powerUpUseRows);
  const context = {
    players,
    teams,
    tasks,
    publishedAt,
    goldenWeekKeys: powerUpKeys(uses, "golden_week"),
  };
  // Recorded bonuses first, then the ones earned by voting in polls and in
  // People's Choice. A held week's bonuses count as given when its results
  // were published, so their notifications arrive after the show.
  const bonusPoints = [
    ...published(bonusRows).map((row) => {
      const at = publishedAt[row.taskId];
      const instant = (value: string) =>
        new Date(timestamptzToIso(value)).getTime();
      return at && instant(at) > instant(row.createdAt)
        ? { ...row, createdAt: at }
        : row;
    }),
    // Polls are site-wide: only this season's players earn their bonus.
    ...derivePollBonusRows(polls).filter((row) =>
      players.some((p) => p.id === row.playerId),
    ),
    ...derivePeoplesChoiceBonusRows(peoplesChoiceVotes, tasks, teams),
  ];
  // Correct predictions depend on the week's finishing positions, and
  // Shields and Mirrors on whether the week's results are out, so rank once
  // without them, then again with their bonuses added (bonuses never change
  // positions or when results are out).
  const ranked = buildScoreRecords({ ...scoreRows, bonusPoints }, context);
  const purchases = mapPurchases(coinPurchaseRows);
  const items = mapShopItems(shopItemRows);
  const sabotageRows = deriveSabotageBonusRows(
    uses,
    players,
    resolveSabotages(uses, purchases, items),
    new Set(Object.keys(ranked.resultsPostedAt)),
  );
  const predictionBonuses = derivePredictionBonusRows(
    predictions,
    ranked,
    players,
    new Map(teams.map((t) => [t.id, t.name])),
    powerUpKeys(uses, "double_down"),
  );
  const derivedBonuses = [...sabotageRows, ...predictionBonuses];
  const records =
    derivedBonuses.length === 0
      ? ranked
      : buildScoreRecords(
          { ...scoreRows, bonusPoints: [...bonusPoints, ...derivedBonuses] },
          context,
        );

  return {
    season,
    players,
    teams,
    tasks,
    ...records,
    polls,
    peoplesChoiceVotes,
    predictions,
    recaps: mapRecaps(recapRows),
    changelog: mapChangelog(changelogRows),
    coins: {
      items,
      purchases,
      uses,
      equipped: mapEquipped(equippedRows),
      adjustments: mapAdjustments(coinAdjustmentRows),
      entries: mapEntries(entryRows),
      crateOpens: mapCrateOpens(crateOpenRows),
      gifts: mapGifts(coinGiftRows),
      itemGifts: mapItemGifts(itemGiftRows),
      wishes: mapWishes(wishRows),
      hints: mapHints(taskRows),
      skillPaths: mapSkillPaths(skillPathRows),
      skillUnlocks: mapSkillUnlocks(skillUnlockRows),
      miniTasks: mapMiniTasks(miniTaskRows),
      miniTaskCompletions: mapMiniTaskCompletions(miniTaskCompletionRows),
      market: mapMarket(marketListingRows, marketOfferRows, marketSaleRows),
    },
    features: mapFeatureFlags(featureFlagRows),
  };
}
