import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  SKILL_PATHS,
  SKILL_REWARD_ITEMS,
  aggregatePerks,
  discountedPrice,
  eggPrice,
  getSkillNode,
  luckyCrate,
  pathCost,
  skillPerksFor,
  unlockedNodes,
} from "./skill-trees";
import { CRATES, SKILL_NAME_COLOURS } from "./coin-rules";
import {
  crateOdds,
  deriveEarnings,
  deriveWallet,
  giftAllowance,
} from "./coins";
import { createQueries } from "./queries";
import type {
  CoinGift,
  SkillEarnSource,
  SkillPerk,
  SkillUnlock,
} from "../types";
import { describePerk, describePerks } from "../lib/skill-ui";
import {
  at,
  coinData,
  competitionData,
  player,
  season,
  shopItem,
  task,
} from "../test/fixtures";
import { shopItems as seedShopItems } from "../../db/seed-data";

// Pure derivations; this only stops the db client's `astro:env` import
// loading (`peoples-choice.ts` sits beside its writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const NOW = at("2026-02-01T00:00:00.000Z");

const unlock = (
  nodeId: string,
  overrides: Partial<SkillUnlock> = {},
): SkillUnlock => {
  const node = getSkillNode(nodeId)!;
  return {
    id: 1,
    playerId: "ann",
    pathId: node.pathId,
    nodeId,
    price: node.price,
    at: "2026-01-10T00:00:00.000Z",
    ...overrides,
  };
};

describe("the skill tree catalogue", () => {
  const nodes = SKILL_PATHS.flatMap((p) => p.nodes);

  it("has unique ids and prerequisites in the same pathway", () => {
    expect(new Set(SKILL_PATHS.map((p) => p.id)).size).toBe(SKILL_PATHS.length);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const node of nodes) {
      for (const id of node.requires) {
        expect(getSkillNode(id)?.pathId).toBe(node.pathId);
        expect(getSkillNode(id)!.tier).toBeLessThan(node.tier);
      }
    }
  });

  it("gives every pathway one root, two branches and a capstone", () => {
    for (const path of SKILL_PATHS) {
      expect(path.nodes.map((n) => n.tier)).toEqual([1, 2, 2, 3]);
      expect(path.nodes[0].requires).toEqual([]);
      expect(pathCost(path)).toBe(36);
    }
  });

  it("never touches leaderboard points", () => {
    const kinds = new Set(nodes.flatMap((n) => n.perks.map((p) => p.kind)));
    expect([...kinds].sort()).toEqual([
      "earn_bonus",
      "egg_discount",
      "egg_luck",
      "gift_cap",
      "power_up_discount",
      "shop_discount",
    ]);
  });

  // The balance model the catalogue is tuned to (see `SKILL_PATHS`): what a
  // committed player gets over a season from each perk.
  const EVENTS: Record<SkillEarnSource, number> = {
    entry: 10,
    placement: 10,
    prediction: 10,
    "peoples-choice-vote": 10,
    "poll-vote": 5,
    "power-up-use": 4,
  };
  const value = (perk: SkillPerk): number => {
    switch (perk.kind) {
      case "earn_bonus":
        return perk.amount * EVENTS[perk.source];
      case "power_up_discount":
        // Each named power-up bought once; "all power-ups" about 5 times.
        return perk.amount * (perk.powerUps?.length ?? 5);
      case "shop_discount":
        return perk.amount * 5;
      case "egg_discount":
        return perk.amount * 4;
      case "egg_luck":
        // ~4 eggs, a rarer prize worth ~6 coins more.
        return perk.amount * 24;
      case "gift_cap":
        return 0;
    }
  };
  const nodeValue = (id: string) =>
    getSkillNode(id)!.perks.reduce((sum, perk) => sum + value(perk), 0);

  it("is balanced: every pathway's tiers are worth about the same", () => {
    for (const path of SKILL_PATHS) {
      const [root, perk, cosmetic, capstone] = path.nodes.map((n) =>
        nodeValue(n.id),
      );
      expect(root, path.id).toBeGreaterThanOrEqual(14);
      expect(root, path.id).toBeLessThanOrEqual(15);
      expect(perk, path.id).toBeGreaterThanOrEqual(15);
      expect(perk, path.id).toBeLessThanOrEqual(17);
      expect(cosmetic, path.id).toBe(10);
      expect(capstone, path.id).toBeGreaterThanOrEqual(24);
      expect(capstone, path.id).toBeLessThanOrEqual(25);
      // Every skill pays back well over its price.
      for (const node of path.nodes) {
        expect(nodeValue(node.id), node.id).toBeGreaterThan(node.price);
      }
    }
    const totals = SKILL_PATHS.map((p) =>
      p.nodes.reduce((sum, n) => sum + nodeValue(n.id), 0),
    );
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(3);
  });

  it("names reward items that are seeded and migrated as skill-only", () => {
    const rewardIds = nodes.flatMap((n) => n.rewardItemId ?? []);
    expect(rewardIds.sort()).toEqual(
      SKILL_REWARD_ITEMS.map((i) => i.id).sort(),
    );
    const seeded = new Map(seedShopItems.map((i) => [i.id, i]));
    const migration = readFileSync("drizzle/0027_skill_trees.sql", "utf8");
    for (const item of SKILL_REWARD_ITEMS) {
      expect(seeded.get(item.id)).toMatchObject({
        skillOnly: true,
        cosmeticKind: item.cosmeticKind,
        cosmeticValue: item.cosmeticValue,
      });
      const sqlText = (text: string) => `'${text.replaceAll("'", "''")}'`;
      expect(migration).toContain(
        [item.id, item.name, item.description].map(sqlText).join(", "),
      );
    }
    const colours = SKILL_REWARD_ITEMS.filter(
      (i) => i.cosmeticKind === "name_colour",
    ).map((i) => i.cosmeticValue);
    expect(colours.sort()).toEqual([...SKILL_NAME_COLOURS].sort());
  });
});

describe("perks", () => {
  it("adds up every unlocked node's perks", () => {
    const perks = aggregatePerks(
      SKILL_PATHS.find((p) => p.id === "stormbrewer")!.nodes,
    );
    expect(perks.powerUpDiscount).toBe(4);
    expect(perks.powerUpDiscounts).toEqual({ golden_week: 2, sabotage: 2 });
    expect(perks.earn).toEqual({
      "power-up-use": 5,
      prediction: 1,
      placement: 1,
    });

    const hacker = aggregatePerks(
      SKILL_PATHS.find((p) => p.id === "elite-hacker")!.nodes,
    );
    expect(hacker.powerUpDiscounts).toEqual({
      hint: 8,
      double_down: 4,
      sabotage: 2,
    });
    expect(hacker.earn.prediction).toBe(3);

    const cartographer = aggregatePerks(
      SKILL_PATHS.find((p) => p.id === "elephant-cartographer")!.nodes,
    );
    expect(cartographer.shopDiscounts).toEqual({
      pet: 2,
      avatar: 2,
      cosmetic: 2,
    });
    expect(cartographer.eggDiscount).toBe(3);
  });

  it("only counts nodes unlocked by a given instant", () => {
    const unlocks = [
      unlock("achiever-gold-star"),
      unlock("achiever-extra-credit", { at: "2026-01-20T00:00:00.000Z" }),
      unlock("friend-plus-one", { playerId: "bob" }),
    ];
    expect(unlockedNodes(unlocks, "ann").map((n) => n.id)).toEqual([
      "achiever-gold-star",
      "achiever-extra-credit",
    ]);
    expect(
      unlockedNodes(unlocks, "ann", at("2026-01-15T00:00:00.000Z")).map(
        (n) => n.id,
      ),
    ).toEqual(["achiever-gold-star"]);
    expect(skillPerksFor(unlocks, "bob").giftCap).toBe(3);
  });

  it("discounts power-ups, wearables and eggs, never below zero", () => {
    const powerUp = (price: number, powerUp: "sabotage" | "hint") => ({
      price,
      category: "power_up" as const,
      powerUp,
    });
    const perks = aggregatePerks([
      getSkillNode("storm-static-charge")!,
      getSkillNode("storm-eye-of-the-hurricane")!,
    ]);
    expect(discountedPrice(powerUp(15, "sabotage"), perks)).toBe(11);
    expect(discountedPrice(powerUp(1, "hint"), perks)).toBe(0);
    // Stormbrewer doesn't discount wearables.
    expect(discountedPrice({ price: 5, category: "pet" }, perks)).toBe(5);

    // The Hint ends up free on a full Elite Hacker tree.
    const hacker = aggregatePerks(
      SKILL_PATHS.find((p) => p.id === "elite-hacker")!.nodes,
    );
    expect(discountedPrice(powerUp(8, "hint"), hacker)).toBe(0);
    expect(discountedPrice(powerUp(15, "sabotage"), hacker)).toBe(13);

    const cartographer = aggregatePerks([
      getSkillNode("cartographer-field-notes")!,
      getSkillNode("cartographer-here-be-dragons")!,
    ]);
    expect(eggPrice({ price: 8 }, cartographer)).toBe(6);
    expect(eggPrice({ price: 1 }, cartographer)).toBe(0);
    expect(discountedPrice({ price: 17, category: "pet" }, cartographer)).toBe(
      15,
    );
    expect(discountedPrice(powerUp(15, "sabotage"), cartographer)).toBe(15);
  });

  it("describes perks in plain words", () => {
    expect(
      describePerk({ kind: "earn_bonus", source: "entry", amount: 1 }),
    ).toBe("+1 coin per entry submitted");
    expect(
      describePerk({
        kind: "power_up_discount",
        amount: 2,
        powerUps: ["golden_week", "sabotage"],
      }),
    ).toBe("Golden Week and Sabotage cost 2 coins less");
    expect(
      describePerk({
        kind: "shop_discount",
        amount: 1,
        categories: ["pet", "avatar", "cosmetic"],
      }),
    ).toBe("pets, avatars and cosmetics cost 1 coin less");
    expect(
      describePerks(
        aggregatePerks(SKILL_PATHS.find((p) => p.id === "stormbrewer")!.nodes),
      ),
    ).toEqual([
      "+5 coins per power-up used",
      "+1 coin per winner call",
      "+1 coin per scored week",
      "power-ups cost 4 coins less",
      "Golden Week costs 2 coins less on top",
      "Sabotage costs 2 coins less on top",
    ]);
  });

  it("moves egg odds from the commonest tier up one, keeping the total", () => {
    const sum = (odds: object) =>
      Object.values(odds).reduce((a: number, b: number) => a + b, 0);
    for (const crate of CRATES) {
      const lucky = luckyCrate(crate, 0.05);
      expect(sum(lucky.odds)).toBeCloseTo(sum(crate.odds), 10);
    }
    const mystery = luckyCrate(CRATES[0], 0.05);
    expect(mystery.odds.common).toBeCloseTo(0.55);
    expect(mystery.odds.rare).toBeCloseTo(0.33);
    // Fabergé has no commons, so rare feeds epic.
    const faberge = luckyCrate(CRATES[1], 0.05);
    expect(faberge.odds.rare).toBeCloseTo(0.5);
    expect(faberge.odds.epic).toBeCloseTo(0.4);
    expect(luckyCrate(CRATES[0], 0)).toBe(CRATES[0]);
  });

  it("raises the gift cap", () => {
    const gifts: CoinGift[] = [
      {
        id: 1,
        fromPlayerId: "ann",
        toPlayerId: "bob",
        amount: 5,
        at: "2026-01-31T00:00:00.000Z",
      },
    ];
    expect(giftAllowance(gifts, "ann", NOW)).toBe(0);
    expect(giftAllowance(gifts, "ann", NOW, 8)).toBe(3);
  });
});

describe("skill tree coins", () => {
  const w1 = task({
    id: "w1",
    weekNumber: 1,
    status: "completed",
    deadline: "2026-01-12T09:00:00.000Z",
  });
  const w2 = task({
    id: "w2",
    weekNumber: 2,
    status: "completed",
    deadline: "2026-01-19T09:00:00.000Z",
  });

  it("pays earning perks only on coins that land after the unlock", () => {
    const data = competitionData({
      tasks: [w1, w2],
      coins: coinData({
        entries: [
          { taskId: "w1", playerId: "ann" },
          { taskId: "w2", playerId: "ann" },
        ],
        skillPaths: [
          {
            playerId: "ann",
            pathId: "overachiever",
            at: "2026-01-15T00:00:00.000Z",
          },
        ],
        skillUnlocks: [
          unlock("achiever-gold-star", { at: "2026-01-15T00:00:00.000Z" }),
        ],
      }),
    });
    const perks = deriveEarnings(data, "ann", NOW).filter(
      (e) => e.kind === "skill-perk",
    );
    expect(perks).toEqual([
      {
        kind: "skill-perk",
        amount: 1,
        label: "Gold Star: Week 02: entry submitted",
        at: w2.deadline,
        taskId: "w2",
      },
    ]);
  });

  it("pays Lightning Rod per power-up used on a finished week", () => {
    const data = competitionData({
      tasks: [w2, task({ id: "w3", weekNumber: 3, status: "live" })],
      coins: coinData({
        uses: [
          {
            id: 1,
            purchaseId: 1,
            playerId: "ann",
            taskId: "w2",
            effect: "golden_week",
            at: "2026-01-14T00:00:00.000Z",
          },
          {
            id: 2,
            purchaseId: 2,
            playerId: "ann",
            taskId: "w3",
            effect: "hint",
            at: "2026-01-21T00:00:00.000Z",
          },
        ],
        skillUnlocks: [
          unlock("storm-static-charge"),
          unlock("storm-lightning-rod", { id: 2 }),
        ],
      }),
    });
    expect(
      deriveEarnings(data, "ann", NOW)
        .filter((e) => e.kind === "skill-perk")
        .map((e) => [e.label, e.amount]),
    ).toEqual([
      ["Static Charge: Week 02: used Golden Week", 1],
      ["Lightning Rod: Week 02: used Golden Week", 3],
    ]);
  });

  it("spends unlock prices and treats reward grants as free", () => {
    const title = shopItem({
      id: "skill-title-stormbrewer",
      name: "Title: Stormbrewer",
      category: "cosmetic",
      price: 0,
      skillOnly: true,
    });
    const data = competitionData({
      coins: coinData({
        items: [title],
        adjustments: [
          {
            id: 1,
            playerId: "ann",
            amount: 30,
            reason: "seed",
            actorName: "TM",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        purchases: [
          {
            id: 9,
            playerId: "ann",
            itemId: title.id,
            price: 0,
            at: "2026-01-11T00:00:00.000Z",
          },
        ],
        skillUnlocks: [
          unlock("storm-static-charge"),
          unlock("storm-thunderhead", {
            id: 2,
            purchaseId: 9,
            at: "2026-01-11T00:00:00.000Z",
          }),
        ],
      }),
    });
    const wallet = deriveWallet(data, "ann", NOW);
    expect(wallet.spent).toBe(13);
    expect(wallet.balance).toBe(17);
    expect(wallet.ledger.filter((e) => e.kind === "skill")).toEqual([
      {
        kind: "skill",
        amount: -8,
        label: "Unlocked Thunderhead (Stormbrewer) → Title: Stormbrewer",
        at: "2026-01-11T00:00:00.000Z",
      },
      {
        kind: "skill",
        amount: -5,
        label: "Unlocked Static Charge (Stormbrewer)",
        at: "2026-01-10T00:00:00.000Z",
      },
    ]);
  });

  it("keeps skill rewards out of eggs", () => {
    const reward = shopItem({ id: "reward", price: 3, skillOnly: true });
    const duck = shopItem({ id: "duck", price: 3 });
    const tiers = crateOdds(CRATES[0], [reward, duck], new Set(), NOW);
    expect(tiers.flatMap((t) => t.drops.map((d) => d.item.id))).toEqual([
      "duck",
    ]);
  });
});

describe("skill queries", () => {
  const grant = (playerId: string, amount: number) => ({
    id: 1,
    playerId,
    amount,
    reason: "seed",
    actorName: "TM",
    at: "2026-01-01T00:00:00.000Z",
  });
  const setup = (
    overrides: Partial<ReturnType<typeof coinData>> = {},
    options: { closed?: boolean; flag?: boolean } = {},
  ) =>
    createQueries(
      competitionData({
        season: season(options.closed ? { status: "closed" } : {}),
        players: [player("ann", "Ann"), player("bob", "Bob")],
        features: {
          shop_eggs: true,
          storm_mode: false,
          skill_trees: options.flag ?? true,
          mini_tasks: false,
          achievements: false,
          marketplace: false,
        },
        coins: coinData({
          items: [
            shopItem({
              id: "skill-title-stormbrewer",
              category: "cosmetic",
              cosmetic: { kind: "title", value: "Stormbrewer" },
              price: 0,
              skillOnly: true,
            }),
            shopItem({
              id: "hint",
              category: "power_up",
              price: 6,
              powerUp: "hint",
            }),
          ],
          adjustments: [grant("ann", 20), grant("bob", 2)],
          ...overrides,
        }),
      }),
    );

  it("works out each node's state for the viewer", () => {
    const q = setup({
      skillPaths: [
        {
          playerId: "ann",
          pathId: "stormbrewer",
          at: "2026-01-10T00:00:00.000Z",
        },
      ],
      skillUnlocks: [unlock("storm-static-charge")],
    });
    const node = (id: string) => getSkillNode(id)!;
    expect(q.getSkillBlock(node("storm-static-charge"), {})).toBe("guest");
    expect(
      q.getSkillBlock(node("storm-static-charge"), { playerId: "ann" }),
    ).toBe("unlocked");
    expect(
      q.getSkillBlock(node("storm-lightning-rod"), { playerId: "ann" }),
    ).toBeUndefined();
    expect(
      q.getSkillBlock(node("storm-eye-of-the-hurricane"), { playerId: "ann" }),
    ).toBe("locked");
    expect(q.getSkillBlock(node("hacker-sudo"), { playerId: "ann" })).toBe(
      "other-path",
    );
    // Bob has 2 coins: every root costs 5.
    expect(q.getSkillBlock(node("hacker-sudo"), { playerId: "bob" })).toBe(
      "unaffordable",
    );

    const view = q.getSkillTrees({ playerId: "ann" });
    expect(view.chosen?.id).toBe("stormbrewer");
    expect(view.paths[0].path.id).toBe("stormbrewer");
    expect(view.paths[0].unlockedCount).toBe(1);
    expect(view.balance).toBe(15);
    const capstone = view.paths[0].tiers[2][0];
    expect(capstone.missing.map((n) => n.id)).toEqual([
      "storm-lightning-rod",
      "storm-thunderhead",
    ]);
    expect(view.paths[0].tiers[1][1].reward?.id).toBe(
      "skill-title-stormbrewer",
    );
  });

  it("freezes trees in a closed season", () => {
    const q = setup({}, { closed: true });
    expect(
      q.getSkillBlock(getSkillNode("hacker-sudo")!, { playerId: "ann" }),
    ).toBe("season-closed");
  });

  it("applies discounts to the shop and hides skill rewards from it", () => {
    const q = setup({
      skillPaths: [
        {
          playerId: "ann",
          pathId: "elite-hacker",
          at: "2026-01-10T00:00:00.000Z",
        },
      ],
      skillUnlocks: [unlock("hacker-sudo")],
    });
    const hint = q.getShopItemById("hint")!;
    expect(q.getItemPrice(hint, "ann")).toBe(2);
    expect(q.getItemPrice(hint, "bob")).toBe(6);
    const listing = q
      .getShopSections({ playerId: "ann" })
      .flatMap((s) => s.listings)
      .find((l) => l.item.id === "hint");
    expect(listing?.price).toBe(2);
    expect(
      q
        .getShopSections({ playerId: "ann" })
        .flatMap((s) => s.listings.map((l) => l.item.id)),
    ).not.toContain("skill-title-stormbrewer");
    expect(
      q.getPurchaseBlock(q.getShopItemById("skill-title-stormbrewer")!, {
        playerId: "bob",
      }),
    ).toBe("skill-only");
  });

  it("raises the gift cap and shows the pathway sigil while the flag is on", () => {
    const overrides = {
      skillPaths: [
        {
          playerId: "ann",
          pathId: "friendkeeper" as const,
          at: "2026-01-10T00:00:00.000Z",
        },
      ],
      skillUnlocks: [unlock("friend-plus-one")],
    };
    const q = setup(overrides);
    expect(q.getGiftPanel("ann", NOW).cap).toBe(8);
    expect(q.getPlayerFlair("ann").skillPath).toEqual({
      id: "friendkeeper",
      name: "Friendkeeper",
      accent: "magenta",
    });
    expect(q.getPlayerSkills("ann")?.unlocked.map((n) => n.id)).toEqual([
      "friend-plus-one",
    ]);

    const off = setup(overrides, { flag: false });
    expect(off.getPlayerFlair("ann").skillPath).toBeUndefined();
    expect(off.getPlayerSkills("ann")).toBeUndefined();
    // Perks already paid for keep working.
    expect(off.getGiftPanel("ann", NOW).cap).toBe(8);
    expect(off.getSkillLog("ann").unlocks).toHaveLength(1);
  });
});
