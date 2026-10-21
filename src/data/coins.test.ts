import { describe, expect, it, vi } from "vitest";
import {
  crateAverageValue,
  crateOdds,
  deriveEarnings,
  deriveSabotageBonusRows,
  deriveWallet,
  placementCoins,
  powerUpKeys,
  rollCrate,
  slotOf,
} from "./coins";
import {
  ENTRY_COINS,
  PEOPLES_CHOICE_VOTE_COINS,
  POLL_VOTE_COINS,
  PREDICTION_COINS,
  goldenWeekPoints,
  rarityOf,
} from "./coin-rules";
import type { Crate, PowerUpUse } from "../types";
import {
  at,
  coinData,
  competitionData,
  player,
  poll,
  shopItem,
  task,
} from "../test/fixtures";

// Pure derivations; this only stops the db client's `astro:env` import
// loading (`peoples-choice.ts` sits beside its writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const done = task({ id: "w1", weekNumber: 1, status: "completed" });
const live = task({
  id: "w2",
  weekNumber: 2,
  status: "live",
  releaseDate: "2026-01-12T09:00:00.000Z",
  deadline: "2026-01-19T09:00:00.000Z",
});
const NOW = at("2026-01-20T00:00:00.000Z");

const use = (overrides: Partial<PowerUpUse>): PowerUpUse => ({
  id: 1,
  purchaseId: 1,
  playerId: "ann",
  taskId: "w1",
  effect: "golden_week",
  at: "2026-01-06T10:00:00.000Z",
  ...overrides,
});

describe("placementCoins", () => {
  it("pays the podium more and everyone else scored the base", () => {
    expect([1, 2, 3, 4, 12].map(placementCoins)).toEqual([10, 7, 5, 2, 2]);
  });
});

describe("goldenWeekPoints", () => {
  it("multiplies by 1.5 and rounds up", () => {
    expect(goldenWeekPoints(10)).toBe(15);
    expect(goldenWeekPoints(7)).toBe(11);
    expect(goldenWeekPoints(1)).toBe(2);
  });

  it("never deepens a zero or a loss", () => {
    expect(goldenWeekPoints(0)).toBe(0);
    expect(goldenWeekPoints(-4)).toBe(-4);
  });
});

describe("slotOf", () => {
  it("wears pets and avatars in their own slot, cosmetics by kind", () => {
    expect(slotOf(shopItem({ category: "pet" }))).toBe("pet");
    expect(slotOf(shopItem({ category: "avatar" }))).toBe("avatar");
    expect(
      slotOf(
        shopItem({
          category: "cosmetic",
          cosmetic: { kind: "name_colour", value: "amber" },
        }),
      ),
    ).toBe("name_colour");
    expect(
      slotOf(shopItem({ category: "power_up", powerUp: "hint" })),
    ).toBeUndefined();
  });
});

describe("deriveEarnings", () => {
  it("pays placements once results are published", () => {
    const data = competitionData({
      tasks: [done],
      scores: [
        { taskId: "w1", playerId: "ann", points: 9, position: 1 },
        { taskId: "w1", playerId: "bob", points: 3, position: 4 },
      ],
      resultsPostedAt: { w1: "2026-01-12T12:00:00.000Z" },
    });
    expect(deriveEarnings(data, "ann", NOW)).toEqual([
      {
        kind: "placement",
        amount: 10,
        label: "Week 01: 1st place",
        at: "2026-01-12T12:00:00.000Z",
        taskId: "w1",
      },
    ]);
    expect(deriveEarnings(data, "bob", NOW)[0]).toMatchObject({
      amount: 2,
      label: "Week 01: scored",
    });
  });

  it("pays entries and calls only once the week's deadline passes", () => {
    const data = competitionData({
      tasks: [done, live],
      predictions: [
        { taskId: "w1", playerId: "ann", pick: { type: "player", id: "bob" } },
        { taskId: "w2", playerId: "ann", pick: { type: "player", id: "bob" } },
      ],
      coins: coinData({
        entries: [
          { taskId: "w1", playerId: "ann" },
          { taskId: "w2", playerId: "ann" },
        ],
      }),
    });
    const earned = deriveEarnings(data, "ann", NOW);
    expect(earned.map((e) => [e.kind, e.taskId, e.amount])).toEqual([
      ["entry", "w1", ENTRY_COINS],
      ["prediction", "w1", PREDICTION_COINS],
    ]);
  });

  it("pays People's Choice votes when voting closes", () => {
    const data = competitionData({
      tasks: [done],
      peoplesChoiceVotes: [
        {
          taskId: "w1",
          playerId: "ann",
          submissionId: 1,
          submitterId: "bob",
          entryHidden: false,
        },
        // A vote for a hidden entry doesn't count.
        {
          taskId: "w1",
          playerId: "ann",
          submissionId: 2,
          submitterId: "cat",
          entryHidden: true,
        },
      ],
    });
    // Voting closes three days after the 12 Jan deadline.
    expect(deriveEarnings(data, "ann", at("2026-01-13T00:00:00Z"))).toEqual([]);
    expect(deriveEarnings(data, "ann", NOW)).toEqual([
      expect.objectContaining({
        kind: "peoples-choice-vote",
        amount: PEOPLES_CHOICE_VOTE_COINS,
      }),
    ]);
  });

  it("pays published poll votes once the poll closes", () => {
    const vote = { optionId: 1, playerId: "ann" };
    const data = competitionData({
      polls: [
        poll({ id: "closed", status: "closed", votes: [vote] }),
        poll({ id: "open", status: "open", votes: [vote] }),
        poll({
          id: "draft",
          status: "closed",
          published: false,
          votes: [vote],
        }),
      ],
    });
    expect(deriveEarnings(data, "ann", NOW)).toEqual([
      expect.objectContaining({ kind: "poll-vote", amount: POLL_VOTE_COINS }),
    ]);
  });
});

describe("deriveWallet", () => {
  it("adds grants, takes away purchases and lists newest first", () => {
    const data = competitionData({
      tasks: [done],
      scores: [{ taskId: "w1", playerId: "ann", points: 9, position: 1 }],
      resultsPostedAt: { w1: "2026-01-12T12:00:00.000Z" },
      coins: coinData({
        items: [shopItem({ id: "duck", name: "Duck", price: 8 })],
        purchases: [
          {
            id: 1,
            playerId: "ann",
            itemId: "duck",
            price: 8,
            at: "2026-01-13T00:00:00.000Z",
          },
          // Someone else's wallet.
          {
            id: 2,
            playerId: "bob",
            itemId: "duck",
            price: 8,
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
        adjustments: [
          {
            id: 1,
            playerId: "ann",
            amount: 5,
            reason: "Best dressed",
            actorName: "Taskmaster",
            at: "2026-01-14T00:00:00.000Z",
          },
        ],
      }),
    });
    const wallet = deriveWallet(data, "ann", NOW);
    expect(wallet).toMatchObject({
      balance: 7,
      earned: 10,
      adjusted: 5,
      spent: 8,
    });
    expect(wallet.ledger.map((e) => [e.kind, e.amount])).toEqual([
      ["adjustment", 5],
      ["purchase", -8],
      ["placement", 10],
    ]);
    expect(wallet.ledger[1].label).toBe("Bought Duck");
  });

  it("can go below zero when earnings shrink after spending", () => {
    const data = competitionData({
      coins: coinData({
        purchases: [
          {
            id: 1,
            playerId: "ann",
            itemId: "duck",
            price: 8,
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(deriveWallet(data, "ann", NOW).balance).toBe(-8);
  });
});

describe("power-up effects", () => {
  it("keys uses of one effect by week and player", () => {
    const uses = [
      use({}),
      use({ id: 2, purchaseId: 2, playerId: "bob", effect: "hint" }),
    ];
    expect([...powerUpKeys(uses, "golden_week")]).toEqual(["w1:ann"]);
  });

  it("turns each Sabotage into a named deduction on its target", () => {
    const uses = [
      use({ effect: "sabotage", targetPlayerId: "bob" }),
      use({ id: 2, purchaseId: 2, playerId: "cat", effect: "hint" }),
    ];
    expect(
      deriveSabotageBonusRows(uses, [player("ann", "Ann"), player("bob")]),
    ).toEqual([
      { taskId: "w1", playerId: "bob", points: -5, reason: "Sabotaged by Ann" },
    ]);
  });
});

describe("crates", () => {
  const crate: Crate = {
    id: "test-crate",
    name: "Test Crate",
    description: "",
    price: 15,
    odds: { common: 0.6, rare: 0.3, legendary: 0.1 },
  };
  const title = shopItem({
    id: "title",
    category: "cosmetic",
    price: 10,
    cosmetic: { kind: "title", value: "Legend" },
  });
  const duck = shopItem({ id: "duck", price: 10 });
  const robot = shopItem({ id: "robot", category: "avatar", price: 20 });
  const ghost = shopItem({ id: "ghost", price: 40, crateOnly: true });
  const items = [
    title,
    duck,
    robot,
    ghost,
    // Never drop: a power-up, a retired item and an epic the crate skips.
    shopItem({ id: "hint", category: "power_up", powerUp: "hint", price: 8 }),
    shopItem({ id: "old", price: 10, available: false }),
    shopItem({ id: "owl", price: 35 }),
  ];

  it("derives rarity from price", () => {
    expect([0, 15, 16, 29, 30, 39, 40, 99].map(rarityOf)).toEqual([
      "common",
      "common",
      "rare",
      "rare",
      "epic",
      "epic",
      "legendary",
      "legendary",
    ]);
  });

  it("splits each tier's chance evenly over what can drop", () => {
    const tiers = crateOdds(crate, items, new Set());
    expect(tiers.map((t) => t.rarity)).toEqual(["common", "rare", "legendary"]);
    const chances = Object.fromEntries(
      tiers.flatMap((t) => t.drops.map((d) => [d.item.id, d.chance])),
    );
    expect(Object.keys(chances)).toEqual(["title", "duck", "robot", "ghost"]);
    expect(chances.title).toBeCloseTo(0.3);
    expect(chances.duck).toBeCloseTo(0.3);
    expect(chances.robot).toBeCloseTo(0.3);
    expect(chances.ghost).toBeCloseTo(0.1);
    expect(crateAverageValue(tiers)).toBeCloseTo(3 + 3 + 6 + 4);
  });

  it("leaves out what you own and shares out an emptied tier", () => {
    const tiers = crateOdds(crate, items, new Set(["robot", "duck"]));
    expect(tiers.map((t) => t.rarity)).toEqual(["common", "legendary"]);
    expect(tiers[0].chance).toBeCloseTo(0.6 / 0.7);
    expect(tiers[1].chance).toBeCloseTo(0.1 / 0.7);
    expect(tiers[0].drops.map((d) => d.item.id)).toEqual(["title"]);
    expect(
      crateOdds(crate, items, new Set(["title", "duck", "robot", "ghost"])),
    ).toEqual([]);
  });

  it("rolls along the cumulative odds", () => {
    const tiers = crateOdds(crate, items, new Set());
    const pick = (r: number) => rollCrate(tiers, r)?.item.id;
    expect(pick(0)).toBe("title");
    expect(pick(0.29)).toBe("title");
    expect(pick(0.31)).toBe("duck");
    expect(pick(0.61)).toBe("robot");
    expect(pick(0.91)).toBe("ghost");
    expect(pick(0.9999999)).toBe("ghost");
    expect(rollCrate(tiers, 0.95)?.rarity).toBe("legendary");
    expect(rollCrate([], 0.5)).toBeUndefined();
  });

  it("charges the crate and hides the free purchase it owns the prize by", () => {
    const data = competitionData({
      coins: coinData({
        items: [shopItem({ id: "ghost", name: "Ghost", price: 40 })],
        purchases: [
          {
            id: 9,
            playerId: "ann",
            itemId: "ghost",
            price: 0,
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
        crateOpens: [
          {
            id: 1,
            purchaseId: 9,
            playerId: "ann",
            crateId: "mystery-egg",
            price: 15,
            itemId: "ghost",
            rarity: "legendary",
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
      }),
    });
    const wallet = deriveWallet(data, "ann", NOW);
    expect(wallet).toMatchObject({ balance: -15, spent: 15 });
    expect(wallet.ledger).toEqual([
      {
        kind: "crate",
        amount: -15,
        label: "Mystery Egg → Ghost (legendary)",
        at: "2026-01-13T00:00:00.000Z",
      },
    ]);
  });
});
