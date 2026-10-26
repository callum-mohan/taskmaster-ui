import { describe, expect, it } from "vitest";
import type { CompetitionRows } from "./competition";
import {
  createSeasonDirectory,
  deriveSeasonStatus,
  isSeasonPublic,
  mapSeasons,
  rowsForSeason,
} from "./seasons";
import { at, season, taskRow, taskScoreRow } from "../test/fixtures";

const seasonRow = (
  id: string,
  createdAt: string,
  overrides: Partial<CompetitionRows["seasonRows"][number]> = {},
): CompetitionRows["seasonRows"][number] => ({
  id,
  name: id,
  isCurrent: false,
  closedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

describe("deriveSeasonStatus", () => {
  const now = at("2026-02-01T00:00:00Z");

  it("is closed once an admin closes it", () => {
    expect(
      deriveSeasonStatus(
        { closedAt: "2026-01-30T00:00:00Z", startsAt: "2027-01-01T00:00:00Z" },
        now,
      ),
    ).toBe("closed");
  });

  it("runs once its first week is released", () => {
    expect(deriveSeasonStatus({ startsAt: "2026-01-05T09:00:00Z" }, now)).toBe(
      "running",
    );
  });

  it("is upcoming before its first week, or with no weeks", () => {
    expect(deriveSeasonStatus({ startsAt: "2026-03-01T09:00:00Z" }, now)).toBe(
      "upcoming",
    );
    expect(deriveSeasonStatus({}, now)).toBe("upcoming");
  });
});

describe("mapSeasons", () => {
  it("orders seasons oldest first with their schedule bounds", () => {
    const seasons = mapSeasons(
      [
        seasonRow("cohort-2027", "2026-12-01 00:00:00+00"),
        seasonRow("cohort-2026", "2026-01-01 00:00:00+00", {
          isCurrent: true,
          closedAt: "2026-06-01 12:00:00+00",
        }),
      ],
      [
        taskRow({ id: "w2", seasonId: "cohort-2026", weekNumber: 2 }),
        taskRow({
          id: "w1",
          seasonId: "cohort-2026",
          releaseDate: "2026-01-01 09:00:00",
          deadline: "2026-01-08 09:00:00",
        }),
      ],
      at("2026-07-01T00:00:00Z"),
    );
    expect(seasons.map((s) => s.id)).toEqual(["cohort-2026", "cohort-2027"]);
    expect(seasons[0]).toMatchObject({
      isCurrent: true,
      status: "closed",
      closedAt: "2026-06-01T12:00:00.000Z",
      startsAt: "2026-01-01T09:00:00.000Z",
      endsAt: "2026-01-12T09:00:00.000Z",
      weekCount: 2,
    });
    expect(seasons[1]).toMatchObject({ status: "upcoming", weekCount: 0 });
    expect(seasons[1]).not.toHaveProperty("startsAt");
  });
});

describe("createSeasonDirectory", () => {
  const old = season({ id: "old", isCurrent: false, status: "closed" });
  const now = season({ id: "now" });
  const directory = createSeasonDirectory([old, now], {
    players: [{ id: "rose", seasonId: "old" }],
    teams: [{ id: "reds", seasonId: "now" }],
    tasks: [{ id: "week-01", seasonId: "old" }],
  });

  it("finds the current season and each record's season", () => {
    expect(directory.current?.id).toBe("now");
    expect(directory.seasonOfPlayer("rose")?.id).toBe("old");
    expect(directory.seasonOfTeam("reds")?.id).toBe("now");
    expect(directory.seasonOfTask("week-01")?.id).toBe("old");
    expect(directory.seasonOfTask("nope")).toBeUndefined();
  });
});

describe("isSeasonPublic", () => {
  it("shows the current and closed seasons, not ones being prepared", () => {
    expect(isSeasonPublic(season())).toBe(true);
    expect(isSeasonPublic(season({ isCurrent: false, status: "closed" }))).toBe(
      true,
    );
    expect(
      isSeasonPublic(season({ isCurrent: false, status: "upcoming" })),
    ).toBe(false);
  });
});

describe("rowsForSeason", () => {
  const empty: CompetitionRows = {
    seasonRows: [],
    playerRows: [],
    teamRows: [],
    memberRows: [],
    taskRows: [],
    taskScoreRows: [],
    teamScoreRows: [],
    bonusRows: [],
    pollRows: [],
    pollOptionRows: [],
    pollVoteRows: [],
    peoplesChoiceRows: [],
    predictionRows: [],
    recapRows: [],
    changelogRows: [],
    shopItemRows: [],
    coinPurchaseRows: [],
    powerUpUseRows: [],
    equippedRows: [],
    coinAdjustmentRows: [],
    entryRows: [],
    crateOpenRows: [],
    coinGiftRows: [],
    featureFlagRows: [],
    itemGiftRows: [],
    eggGiftRows: [],
    wishRows: [],
    skillPathRows: [],
    skillUnlockRows: [],
    miniTaskRows: [],
    miniTaskCompletionRows: [],
    marketListingRows: [],
    marketOfferRows: [],
    marketSaleRows: [],
  };
  const player = (id: string, seasonId: string) => ({
    id,
    seasonId,
    name: id,
    bio: null,
    avatarUrl: null,
    sortOrder: 0,
  });
  const prediction = (taskId: string, playerId: string) => ({
    taskId,
    playerId,
    pickedPlayerId: "x",
    pickedTeamId: null,
    createdAt: "2026-01-01 00:00:00+00",
    updatedAt: "2026-01-01 00:00:00+00",
  });

  const purchase = (id: number, playerId: string) => ({
    id,
    playerId,
    itemId: "duck",
    price: 5,
    createdAt: "2026-01-01 00:00:00+00",
  });
  const use = (id: number, taskId: string, playerId: string) => ({
    id,
    purchaseId: id,
    playerId,
    taskId,
    effect: "hint" as const,
    targetPlayerId: null,
    createdAt: "2026-01-01 00:00:00+00",
  });

  const gift = (id: number, seasonId: string, playerId: string) => ({
    id,
    seasonId,
    fromPlayerId: playerId,
    toPlayerId: "x",
    amount: 2,
    message: null,
    createdAt: "2026-01-01 00:00:00+00",
  });

  const rows: CompetitionRows = {
    ...empty,
    playerRows: [player("ann", "a"), player("bob", "b")],
    taskRows: [
      taskRow({ id: "a1", seasonId: "a" }),
      taskRow({ id: "b1", seasonId: "b" }),
    ],
    taskScoreRows: [taskScoreRow("a1", "ann", 5), taskScoreRow("b1", "bob", 7)],
    predictionRows: [
      prediction("a1", "ann"),
      // A player from another season can't predict on this one's weeks.
      prediction("a1", "bob"),
      prediction("b1", "bob"),
    ],
    coinPurchaseRows: [
      purchase(1, "ann"),
      // Another season's wallet.
      purchase(2, "bob"),
    ],
    powerUpUseRows: [
      use(1, "a1", "ann"),
      // A player from another season can't use power-ups on this one's weeks.
      use(2, "a1", "bob"),
    ],
    coinGiftRows: [
      gift(1, "a", "ann"),
      // Another season's gift.
      gift(2, "b", "bob"),
    ],
    shopItemRows: [
      {
        id: "duck",
        name: "Duck",
        description: "",
        category: "pet",
        price: 5,
        imageUrl: "/shop/pets/duck.svg",
        cosmeticKind: null,
        cosmeticValue: null,
        powerUp: null,
        available: true,
        crateOnly: false,
        crateId: null,
        skillOnly: false,
        availableFrom: null,
        availableUntil: null,
        sortOrder: 0,
        createdAt: "2026-01-01 00:00:00+00",
        updatedAt: "2026-01-01 00:00:00+00",
      },
    ],
    changelogRows: [
      {
        id: "x",
        date: "2026-01-01",
        title: "x",
        description: "x",
        category: "new",
        createdAt: "2026-01-01 00:00:00+00",
        updatedAt: "2026-01-01 00:00:00+00",
      },
    ],
  };

  it("keeps only the season's roster, weeks and their rows", () => {
    const scoped = rowsForSeason(rows, "a");
    expect(scoped.playerRows.map((r) => r.id)).toEqual(["ann"]);
    expect(scoped.taskRows.map((r) => r.id)).toEqual(["a1"]);
    expect(scoped.taskScoreRows).toEqual([taskScoreRow("a1", "ann", 5)]);
    expect(scoped.predictionRows).toEqual([prediction("a1", "ann")]);
    expect(scoped.coinPurchaseRows).toEqual([purchase(1, "ann")]);
    expect(scoped.powerUpUseRows).toEqual([use(1, "a1", "ann")]);
    expect(scoped.coinGiftRows).toEqual([gift(1, "a", "ann")]);
  });

  it("leaves site-wide rows alone", () => {
    const scoped = rowsForSeason(rows, "a");
    expect(scoped.changelogRows).toHaveLength(1);
    expect(scoped.shopItemRows).toHaveLength(1);
  });
});
