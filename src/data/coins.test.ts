import { describe, expect, it, vi } from "vitest";
import {
  crateAverageValue,
  crateOdds,
  deriveEarnings,
  deriveSabotageBonusRows,
  deriveWallet,
  giftAllowance,
  insuranceClaims,
  placementCoins,
  powerUpKeys,
  resolveSabotages,
  rollCrate,
  slotOf,
} from "./coins";
import {
  ENTRY_COINS,
  PEOPLES_CHOICE_VOTE_COINS,
  POLL_VOTE_COINS,
  PREDICTION_COINS,
  cratesOnSale,
  goldenWeekPoints,
  inSaleWindow,
  rarityOf,
} from "./coin-rules";
import type {
  CoinGift,
  CoinPurchase,
  Crate,
  PowerUpKind,
  PowerUpUse,
  ShopItem,
} from "../types";
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
    price: 5,
    cosmetic: { kind: "title", value: "Legend" },
  });
  const duck = shopItem({ id: "duck", price: 5 });
  const robot = shopItem({ id: "robot", category: "avatar", price: 10 });
  const ghost = shopItem({ id: "ghost", price: 20, crateOnly: true });
  const items = [
    title,
    duck,
    robot,
    ghost,
    // Never drop: a power-up, a retired item and an epic the crate skips.
    shopItem({ id: "hint", category: "power_up", powerUp: "hint", price: 8 }),
    shopItem({ id: "old", price: 5, available: false }),
    shopItem({ id: "owl", price: 17 }),
  ];

  it("derives rarity from price", () => {
    expect([0, 7, 8, 14, 15, 19, 20, 99].map(rarityOf)).toEqual([
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
    expect(crateAverageValue(tiers)).toBeCloseTo(1.5 + 1.5 + 3 + 2);
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

describe("admin item gifts", () => {
  it("costs nothing and shows as a gift, not a purchase", () => {
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
        itemGifts: [
          {
            id: 1,
            purchaseId: 9,
            playerId: "ann",
            itemId: "ghost",
            reason: "Best costume",
            actorName: "Taskmaster",
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
      }),
    });
    const wallet = deriveWallet(data, "ann", NOW);
    expect(wallet.balance).toBe(0);
    expect(wallet.ledger).toEqual([
      {
        kind: "item-gift",
        amount: 0,
        label: "Gifted Ghost: Best costume",
        at: "2026-01-13T00:00:00.000Z",
      },
    ]);
    expect(deriveWallet(data, "bob", NOW).ledger).toEqual([]);
  });
});

describe("passive defences", () => {
  const shield = shopItem({
    id: "shield",
    category: "power_up",
    powerUp: "shield",
  });
  const mirror = shopItem({
    id: "mirror",
    category: "power_up",
    powerUp: "mirror",
  });
  const items = [shield, mirror];
  const buy = (
    id: number,
    playerId: string,
    item: ShopItem,
    at = "2026-01-05T00:00:00.000Z",
  ): CoinPurchase => ({ id, playerId, itemId: item.id, price: 10, at });
  const sabotage = (
    id: number,
    playerId: string,
    targetPlayerId: string,
    taskId = "w1",
    at = "2026-01-06T00:00:00.000Z",
  ) =>
    use({
      id,
      purchaseId: 100 + id,
      playerId,
      taskId,
      targetPlayerId,
      at,
      effect: "sabotage",
    });

  it("spends a Mirror before a Shield, each on one Sabotage", () => {
    const resolved = resolveSabotages(
      [
        sabotage(1, "ann", "bob"),
        sabotage(2, "cat", "bob", "w2"),
        sabotage(3, "ann", "bob", "w3"),
      ],
      [buy(1, "bob", shield), buy(2, "bob", mirror)],
      items,
    );
    expect([...resolved]).toEqual([
      [1, { outcome: "reflected", defencePurchaseId: 2 }],
      [2, { outcome: "blocked", defencePurchaseId: 1 }],
      [3, { outcome: "hit" }],
    ]);
  });

  it("only covers Sabotages used after the defence was bought", () => {
    const resolved = resolveSabotages(
      [sabotage(1, "ann", "bob", "w1", "2026-01-06T00:00:00.000Z")],
      [buy(1, "bob", shield, "2026-01-07T00:00:00.000Z")],
      items,
    );
    expect(resolved.get(1)).toEqual({ outcome: "hit" });
  });

  it("keeps defences secret until the week's results are out", () => {
    const uses = [sabotage(1, "ann", "bob"), sabotage(2, "ann", "cat", "w2")];
    const resolved = new Map([
      [1, { outcome: "reflected" as const }],
      [2, { outcome: "blocked" as const }],
    ]);
    const players = [
      player("ann", "Ann"),
      player("bob", "Bob"),
      player("cat", "Cat"),
    ];
    // Before results: both land on their targets as usual.
    expect(
      deriveSabotageBonusRows(uses, players, resolved, new Set()).map(
        (r) => r.playerId,
      ),
    ).toEqual(["bob", "cat"]);
    // After: the bounced one hits Ann instead, and the blocked one is gone.
    expect(
      deriveSabotageBonusRows(uses, players, resolved, new Set(["w1", "w2"])),
    ).toEqual([
      {
        taskId: "w1",
        playerId: "ann",
        points: -5,
        reason: "Sabotage bounced off Bob's Mirror",
      },
    ]);
  });
});

describe("insurance", () => {
  const insurance = shopItem({
    id: "insurance",
    category: "power_up",
    powerUp: "insurance",
  });
  const week = (n: number) =>
    task({
      id: `w${n}`,
      weekNumber: n,
      deadline: `2026-01-${String(n * 7).padStart(2, "0")}T09:00:00.000Z`,
    });
  const tasks = [week(1), week(2), week(3)];
  // Five scored each week: Bob last in weeks 1–3, Cat tied last in week 3.
  const scores = tasks.flatMap((t) =>
    ["ann", "dan", "eve", "cat", "bob"].map((playerId, i) => ({
      taskId: t.id,
      playerId,
      points: 10 - i,
      position: t.id === "w3" && playerId === "cat" ? 5 : i + 1,
    })),
  );
  const data = (boughtAt: string) =>
    competitionData({
      tasks,
      scores,
      resultsPostedAt: Object.fromEntries(tasks.map((t) => [t.id, t.deadline])),
      coins: coinData({
        items: [insurance],
        purchases: [
          {
            id: 7,
            playerId: "bob",
            itemId: "insurance",
            price: 10,
            at: boughtAt,
          },
          {
            id: 8,
            playerId: "cat",
            itemId: "insurance",
            price: 10,
            at: boughtAt,
          },
        ],
      }),
    });

  it("pays 3rd-place coins for the first last place after buying", () => {
    // Bought after week 1's deadline: covers week 2.
    const d = data("2026-01-08T00:00:00.000Z");
    expect([...insuranceClaims(d, "bob")]).toEqual([["w2", 7]]);
    const placements = deriveEarnings(d, "bob", NOW).filter(
      (e) => e.kind === "placement",
    );
    expect(placements.map((e) => [e.taskId, e.amount])).toEqual([
      ["w1", 2],
      ["w2", 5],
      ["w3", 2],
    ]);
    expect(placements[1].label).toBe(
      "Week 02: last place, Insurance paid 3rd-place coins",
    );
  });

  it("counts a shared last place, and waits while nothing qualifies", () => {
    const d = data("2026-01-08T00:00:00.000Z");
    expect([...insuranceClaims(d, "cat")]).toEqual([["w3", 8]]);
    // Bought after every deadline: nothing to pay out yet.
    expect(insuranceClaims(data("2026-02-01T00:00:00.000Z"), "bob").size).toBe(
      0,
    );
  });
});

describe("gifts", () => {
  const gift = (
    id: number,
    from: string,
    to: string,
    amount: number,
    at: string,
    message?: string,
  ): CoinGift => ({
    id,
    fromPlayerId: from,
    toPlayerId: to,
    amount,
    at,
    ...(message && { message }),
  });

  it("moves coins between wallets and lists both sides", () => {
    const data = competitionData({
      players: [player("ann", "Ann"), player("bob", "Bob")],
      coins: coinData({
        gifts: [gift(1, "ann", "bob", 3, "2026-01-14T00:00:00.000Z", "gg")],
      }),
    });
    const ann = deriveWallet(data, "ann", NOW);
    const bob = deriveWallet(data, "bob", NOW);
    expect(ann).toMatchObject({ balance: -3, gifted: -3 });
    expect(bob).toMatchObject({ balance: 3, gifted: 3 });
    expect(ann.ledger[0]).toMatchObject({
      kind: "gift-out",
      label: 'Gift to Bob: "gg"',
    });
    expect(bob.ledger[0]).toMatchObject({
      kind: "gift-in",
      label: 'Gift from Ann: "gg"',
    });
  });

  it("caps what a player sends in any 7 days", () => {
    const gifts = [
      gift(1, "ann", "bob", 2, "2026-01-12T00:00:00.000Z"),
      gift(2, "ann", "bob", 2, "2026-01-19T00:00:00.000Z"),
      gift(3, "bob", "ann", 5, "2026-01-19T00:00:00.000Z"),
    ];
    // The first gift is just over 7 days old, so only the second counts.
    expect(giftAllowance(gifts, "ann", NOW)).toBe(3);
    expect(giftAllowance(gifts, "bob", NOW)).toBe(0);
    expect(giftAllowance(gifts, "cat", NOW)).toBe(5);
  });
});

describe("sale windows and seasonal eggs", () => {
  const halloween: Crate = {
    id: "spooky",
    name: "Spooky",
    description: "",
    price: 20,
    odds: { common: 1 },
    exclusive: true,
    availableFrom: "2026-10-20T23:00:00.000Z",
    availableUntil: "2026-10-31T23:59:59.000Z",
  };
  const regular: Crate = { ...halloween, id: "plain", exclusive: undefined };
  const bat = shopItem({
    id: "bat",
    price: 5,
    crateOnly: true,
    crateId: "spooky",
  });
  const duck = shopItem({ id: "duck", price: 5 });
  const limited = shopItem({
    id: "hat",
    price: 5,
    availableFrom: "2026-10-21T00:00:00.000Z",
    availableUntil: "2026-10-25T00:00:00.000Z",
  });
  const ids = (crate: Crate, now: number) =>
    crateOdds(crate, [bat, duck, limited], new Set(), now).flatMap((t) =>
      t.drops.map((d) => d.item.id),
    );

  it("opens a window at its start and closes it at its end", () => {
    expect(inSaleWindow({}, 0)).toBe(true);
    expect(inSaleWindow(limited, at("2026-10-20T23:59:59.000Z"))).toBe(false);
    expect(inSaleWindow(limited, at("2026-10-21T00:00:00.000Z"))).toBe(true);
    expect(inSaleWindow(limited, at("2026-10-25T00:00:00.000Z"))).toBe(false);
  });

  it("keeps a seasonal egg's exclusives out of every other egg", () => {
    const now = at("2026-10-22T00:00:00.000Z");
    expect(ids(halloween, now)).toEqual(["bat"]);
    expect(ids(regular, now)).toEqual(["duck", "hat"]);
    // Limited stock stops dropping when its window closes.
    expect(ids(regular, at("2026-10-26T00:00:00.000Z"))).toEqual(["duck"]);
  });

  it("only sells the Haunted Egg around Halloween (UK time)", () => {
    const onSale = (iso: string) =>
      cratesOnSale(at(iso))
        .map((c) => c.id)
        .includes("halloween-egg");
    expect(onSale("2026-10-20T22:59:59.000Z")).toBe(false);
    // Midnight on 21 Oct in BST.
    expect(onSale("2026-10-20T23:00:00.000Z")).toBe(true);
    // 31 Oct is GMT again, so 23:59 UK is 23:59 UTC.
    expect(onSale("2026-10-31T23:59:00.000Z")).toBe(true);
    expect(onSale("2026-11-01T00:00:00.000Z")).toBe(false);
    expect(
      cratesOnSale(at("2026-11-01T00:00:00.000Z")).map((c) => c.id),
    ).toEqual(["mystery-egg", "faberge-egg"]);
  });
});

describe("power-ups in eggs", () => {
  const crate: Crate = {
    id: "test-crate",
    name: "Test Crate",
    description: "",
    price: 8,
    odds: { common: 0.75, rare: 0.25 },
    powerUpChance: 0.04,
  };
  const duck = shopItem({ id: "duck", price: 5 });
  const robot = shopItem({ id: "robot", category: "avatar", price: 10 });
  const powerUp = (id: string, name: string, kind: PowerUpKind) =>
    shopItem({ id, name, category: "power_up", powerUp: kind, price: 12 });
  const hint = powerUp("hint", "Hint", "hint");
  const shield = powerUp("shield", "Shield", "shield");
  const retiredSabotage = {
    ...powerUp("sab", "Sabotage", "sabotage"),
    available: false,
  };
  const items = [duck, robot, hint, shield, retiredSabotage];

  it("takes a small, fixed power-up chance off the top", () => {
    const tiers = crateOdds(crate, items, new Set(), NOW);
    expect(tiers.map((t) => [t.rarity, t.chance])).toEqual([
      ["common", 0.75 * 0.96],
      ["rare", 0.25 * 0.96],
      ["power_up", 0.04],
    ]);
    // Retired power-ups never drop; on-sale ones share the chance.
    expect(tiers[2].drops.map((d) => [d.item.id, d.chance])).toEqual([
      ["hint", 0.02],
      ["shield", 0.02],
    ]);
    // Wearables take the first 96% of the roll; then Hint, then Shield.
    expect(rollCrate(tiers, 0.97)?.item.id).toBe("hint");
    expect(rollCrate(tiers, 0.99)).toEqual({
      item: shield,
      rarity: "power_up",
    });
  });

  it("only drops power-ups the player hasn't had this season", () => {
    const tiers = crateOdds(crate, items, new Set(), NOW, new Set(["hint"]));
    expect(tiers.at(-1)?.drops.map((d) => d.item.id)).toEqual(["shield"]);
    // With none left, the chance goes back to the other tiers.
    const none = crateOdds(
      crate,
      items,
      new Set(),
      NOW,
      new Set(["hint", "shield"]),
    );
    expect(none.map((t) => [t.rarity, t.chance])).toEqual([
      ["common", 0.75],
      ["rare", 0.25],
    ]);
  });

  it("is empty once only power-ups are left, so it never sells them cheap", () => {
    expect(crateOdds(crate, items, new Set(["duck", "robot"]), NOW)).toEqual(
      [],
    );
  });

  it("labels a hatched power-up in the wallet", () => {
    const data = competitionData({
      coins: coinData({
        items: [shield],
        purchases: [
          {
            id: 3,
            playerId: "ann",
            itemId: "shield",
            price: 0,
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
        crateOpens: [
          {
            id: 1,
            purchaseId: 3,
            playerId: "ann",
            crateId: "mystery-egg",
            price: 8,
            itemId: "shield",
            rarity: "power_up",
            at: "2026-01-13T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(deriveWallet(data, "ann", NOW).ledger[0].label).toBe(
      "Mystery Egg → Shield (power-up)",
    );
  });
});
