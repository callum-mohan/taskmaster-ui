import { describe, expect, it, vi } from "vitest";
import { createCoinQueries } from "./coin-queries";
import type { CoinPurchase, PowerUpUse, ShopItem } from "../types";
import {
  coinData,
  competitionData,
  player,
  season,
  shopItem,
  task,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const duck = shopItem({ id: "duck", name: "Duck", price: 10 });
const robot = shopItem({
  id: "robot",
  name: "Robot",
  category: "avatar",
  price: 5,
  imageUrl: "/shop/avatars/robot.svg",
});
const amber = shopItem({
  id: "amber",
  name: "Amber Name",
  category: "cosmetic",
  price: 5,
  cosmetic: { kind: "name_colour", value: "amber" },
});
const sabotage = shopItem({
  id: "sabotage",
  name: "Sabotage",
  category: "power_up",
  price: 3,
  powerUp: "sabotage",
});
const hint = shopItem({
  id: "hint",
  name: "Hint",
  category: "power_up",
  price: 3,
  powerUp: "hint",
});
const doubleDown = shopItem({
  id: "dd",
  name: "Double Down",
  category: "power_up",
  price: 3,
  powerUp: "double_down",
});
const retired = shopItem({ id: "old", name: "Old", available: false });

const live = task({ id: "w2", weekNumber: 2, status: "live" });
const done = task({ id: "w1", weekNumber: 1, status: "completed" });

let nextId = 1;
const bought = (playerId: string, item: ShopItem): CoinPurchase => ({
  id: nextId++,
  playerId,
  itemId: item.id,
  price: item.price,
  at: "2026-01-13T00:00:00.000Z",
});

function setup({
  purchases = [] as CoinPurchase[],
  uses = [] as PowerUpUse[],
  closed = false,
  grant = 20,
} = {}) {
  return createCoinQueries(
    competitionData({
      season: season({ status: closed ? "closed" : "running" }),
      players: [player("ann", "Ann"), player("bob", "Bob"), player("cat")],
      tasks: [done, live],
      predictions: [
        { taskId: "w2", playerId: "bob", pick: { type: "player", id: "ann" } },
      ],
      coins: coinData({
        items: [duck, robot, amber, sabotage, hint, doubleDown, retired],
        purchases,
        uses,
        adjustments: ["ann", "bob"].map((playerId, i) => ({
          id: i + 1,
          playerId,
          amount: grant,
          reason: "Starter coins",
          actorName: "Taskmaster",
          at: "2026-01-10T00:00:00.000Z",
        })),
        equipped: [
          { playerId: "ann", slot: "pet", itemId: "duck" },
          { playerId: "ann", slot: "name_colour", itemId: "amber" },
          // Not owned: ignored.
          { playerId: "ann", slot: "avatar", itemId: "robot" },
        ],
        hints: { w2: "Think smaller." },
      }),
    }),
  );
}

describe("purchase blocks", () => {
  it("lets a player with enough coins buy, and explains everyone else", () => {
    const q = setup({ purchases: [bought("ann", duck)] });
    expect(q.getPurchaseBlock(robot, { playerId: "ann" })).toBeUndefined();
    expect(q.getPurchaseBlock(duck, {})).toBe("guest");
    expect(q.getPurchaseBlock(duck, { playerId: "zed" })).toBe("guest");
    expect(q.getPurchaseBlock(duck, { playerId: "ann" })).toBe("owned");
    expect(q.getPurchaseBlock(retired, { playerId: "bob" })).toBe(
      "unavailable",
    );
    expect(q.getPurchaseBlock(duck, { playerId: "cat" })).toBe("unaffordable");
  });

  it("sells each power-up once a season, even through another item", () => {
    const charge = bought("ann", hint);
    const held = setup({ purchases: [charge] });
    expect(held.getPurchaseBlock(hint, { playerId: "ann" })).toBe("owned");
    // A second item with the same effect doesn't get round it.
    const hint2 = shopItem({ ...hint, id: "hint-2" });
    expect(held.getPurchaseBlock(hint2, { playerId: "ann" })).toBe("owned");
    expect(held.getPurchaseBlock(hint, { playerId: "bob" })).toBeUndefined();

    const spent = setup({
      purchases: [charge],
      uses: [
        {
          id: 1,
          purchaseId: charge.id,
          playerId: "ann",
          taskId: "w1",
          effect: "hint",
          at: "2026-01-06T00:00:00.000Z",
        },
      ],
    });
    expect(spent.getPurchaseBlock(hint, { playerId: "ann" })).toBe("used");
    const listing = spent
      .getShopSections({ playerId: "ann" })
      .find((s) => s.category === "power_up")
      ?.listings.find((l) => l.item.id === "hint");
    expect(listing).toMatchObject({ owned: true, charges: 0, blocked: "used" });
  });

  it("freezes a closed season", () => {
    expect(
      setup({ closed: true }).getPurchaseBlock(hint, { playerId: "ann" }),
    ).toBe("season-closed");
  });
});

describe("loadout and inventory", () => {
  it("only wears items the player still owns, in their slot", () => {
    const q = setup({ purchases: [bought("ann", duck), bought("ann", amber)] });
    expect(q.getLoadout("ann")).toEqual({ pet: duck, nameColour: "amber" });
    expect(q.getPlayerFlair("ann")).toEqual({
      pet: { name: "Duck", imageUrl: duck.imageUrl },
      nameColour: "amber",
    });
    expect(q.getEquippedAvatarUrl("ann")).toBeUndefined();
    expect(q.getPlayerFlairs()).toEqual({ ann: q.getPlayerFlair("ann") });
  });

  it("lists owned items and power-ups not used yet", () => {
    const spent = bought("ann", sabotage);
    const q = setup({
      purchases: [bought("ann", duck), spent, bought("ann", hint)],
      uses: [
        {
          id: 1,
          purchaseId: spent.id,
          playerId: "ann",
          taskId: "w1",
          effect: "sabotage",
          targetPlayerId: "bob",
          at: "2026-01-06T00:00:00.000Z",
        },
      ],
    });
    expect(
      q.getInventory("ann").map((i) => [i.item.id, i.equipped, i.charges]),
    ).toEqual([
      ["duck", true, 0],
      ["hint", false, 1],
    ]);
  });

  it("shows the shop's available items with the viewer's state", () => {
    const q = setup({ purchases: [bought("ann", duck)] });
    const sections = q.getShopSections({ playerId: "ann" });
    expect(sections.map((s) => s.category)).toEqual([
      "pet",
      "avatar",
      "cosmetic",
      "power_up",
    ]);
    expect(sections[0].listings).toEqual([
      { item: duck, owned: true, charges: 0, blocked: "owned" },
    ]);
  });
});

describe("power-ups", () => {
  it("only works on the live week, once per player per week", () => {
    const charge = bought("ann", sabotage);
    const q = setup({ purchases: [charge, bought("ann", hint)] });
    expect(q.getPowerUpBlock("ann", live, "sabotage")).toBeUndefined();
    expect(q.getPowerUpBlock("ann", done, "sabotage")).toBe("not-live");
    expect(q.getPowerUpBlock("bob", live, "sabotage")).toBe("no-charge");

    const used = setup({
      purchases: [charge, bought("ann", hint)],
      uses: [
        {
          id: 1,
          purchaseId: charge.id,
          playerId: "ann",
          taskId: "w2",
          effect: "sabotage",
          targetPlayerId: "bob",
          at: "2026-01-13T00:00:00.000Z",
        },
      ],
    });
    expect(used.getPowerUpBlock("ann", live, "hint")).toBe("already-used");
    expect(used.getPowerUpPanel("ann").used?.label).toBe("sabotaged Bob");
  });

  it("needs a call for Double Down and a hint for Hint", () => {
    const q = setup({
      purchases: [bought("ann", doubleDown), bought("bob", doubleDown)],
    });
    expect(q.getPowerUpBlock("ann", live, "double_down")).toBe("no-prediction");
    expect(q.getPowerUpBlock("bob", live, "double_down")).toBeUndefined();
  });

  it("can't sabotage yourself or a player already hit this week", () => {
    const charge = bought("bob", sabotage);
    const q = setup({
      uses: [
        {
          id: 1,
          purchaseId: charge.id,
          playerId: "bob",
          taskId: "w2",
          effect: "sabotage",
          targetPlayerId: "cat",
          at: "2026-01-13T00:00:00.000Z",
        },
      ],
    });
    expect(q.getSabotageTargets("ann", "w2").map((p) => p.id)).toEqual(["bob"]);
    expect(q.getSabotagesOf("cat").map((u) => u.player.id)).toEqual(["bob"]);
  });

  it("shows the hint only to a player who used Hint on that week", () => {
    const charge = bought("ann", hint);
    const q = setup({
      purchases: [charge],
      uses: [
        {
          id: 1,
          purchaseId: charge.id,
          playerId: "ann",
          taskId: "w2",
          effect: "hint",
          at: "2026-01-13T00:00:00.000Z",
        },
      ],
    });
    expect(q.getUnlockedHint("w2", "ann")).toBe("Think smaller.");
    expect(q.getUnlockedHint("w2", "bob")).toBeUndefined();
    expect(q.getUnlockedHint("w2", undefined)).toBeUndefined();
    expect(q.getPowerUpFeed("w2").map((e) => e.label)).toEqual([
      "took the Taskmaster's Hint",
    ]);
  });

  it("closes power-ups in a closed season", () => {
    const q = setup({ closed: true, purchases: [bought("ann", hint)] });
    expect(q.getPowerUpWeek()).toBeUndefined();
    expect(q.getPowerUpBlock("ann", live, "hint")).toBe("season-closed");
  });
});

describe("crates", () => {
  const exclusive = shopItem({
    id: "egg",
    name: "Egg",
    price: 50,
    crateOnly: true,
  });

  it("never sells crate exclusives directly", () => {
    const q = createCoinQueries(
      competitionData({
        players: [player("ann")],
        coins: coinData({ items: [exclusive] }),
      }),
    );
    expect(q.getPurchaseBlock(exclusive, { playerId: "ann" })).toBe(
      "crate-only",
    );
  });

  it("shows each viewer their own odds, and why they can't open", () => {
    const q = setup({ purchases: [bought("ann", duck)], grant: 40 });
    const [mystery, premium] = q.getCrateViews({ playerId: "ann" });
    // Ann owns the duck, so only the robot and the name colour can drop.
    expect(mystery.tiers.flatMap((t) => t.drops.map((d) => d.item.id))).toEqual(
      ["robot", "amber"],
    );
    expect(mystery.blocked).toBeUndefined();
    // Nothing rare or better is left, so the premium crate is empty.
    expect(premium.tiers).toEqual([]);
    expect(premium.blocked).toBe("empty");
    expect(q.getCrateViews({})[0].blocked).toBe("guest");
    expect(q.getCrateViews({ playerId: "cat" })[0].blocked).toBe(
      "unaffordable",
    );
    expect(
      setup({ grant: 10 }).getCrateViews({ playerId: "ann" })[0].blocked,
    ).toBe("unaffordable");
  });

  it("lists pulls publicly and reveals one only to its opener", () => {
    const q = createCoinQueries(
      competitionData({
        players: [player("ann", "Ann"), player("bob")],
        coins: coinData({
          items: [exclusive],
          crateOpens: [
            {
              id: 4,
              purchaseId: 1,
              playerId: "ann",
              crateId: "faberge-egg",
              price: 30,
              itemId: "egg",
              rarity: "legendary",
              at: "2026-01-13T00:00:00.000Z",
            },
          ],
        }),
      }),
    );
    expect(q.getRecentPulls()).toEqual([
      expect.objectContaining({
        id: 4,
        rarity: "legendary",
        item: exclusive,
        player: expect.objectContaining({ id: "ann" }),
      }),
    ]);
    expect(q.getCratePull(4, "ann")?.item.id).toBe("egg");
    expect(q.getCratePull(4, "bob")).toBeUndefined();
  });
});
