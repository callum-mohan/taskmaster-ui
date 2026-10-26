import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoinAdjustment,
  CoinPurchase,
  CompetitionData,
  MarketData,
  MarketListing,
  MarketOffer,
  MarketSale,
} from "../types";
import { createCoinQueries } from "./coin-queries";
import { createMarketQueries } from "./market-queries";
import { createNotificationQueries } from "./notification-queries";
import { deriveWallet } from "./coins";
import { MARKET_LISTING_MS, isTradeable, marketPriceRange } from "./coin-rules";
import {
  heldCoins,
  listingStatus,
  offerStatus,
  soldPurchaseIds,
} from "./market-mappers";
import {
  at,
  coinData,
  competitionData,
  player,
  season,
  shopItem,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const NOW = at("2026-10-20T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const duck = shopItem({ id: "duck", name: "Duck", price: 10 });
const crown = shopItem({
  id: "crown",
  name: "Crown",
  category: "cosmetic",
  price: 8,
  imageUrl: undefined,
  cosmetic: { kind: "title", value: "Royalty" },
});
const egg = shopItem({ id: "egg-pet", name: "Egg Pet", crateOnly: true });
const hint = shopItem({
  id: "hint",
  name: "Hint",
  category: "power_up",
  price: 6,
  imageUrl: undefined,
  powerUp: "hint",
});
const shield = shopItem({
  id: "shield",
  name: "Shield",
  category: "power_up",
  price: 6,
  imageUrl: undefined,
  powerUp: "shield",
});
const skillTitle = shopItem({
  id: "skill-title",
  name: "Stormcaller",
  category: "cosmetic",
  price: 0,
  imageUrl: undefined,
  skillOnly: true,
  cosmetic: { kind: "title", value: "Stormcaller" },
});

const purchase = (
  id: number,
  playerId: string,
  itemId: string,
  price = 0,
): CoinPurchase => ({ id, playerId, itemId, price, at: iso(NOW - 5 * DAY) });

const grant = (
  id: number,
  playerId: string,
  amount: number,
): CoinAdjustment => ({
  id,
  playerId,
  amount,
  reason: "seed",
  actorName: "TM",
  at: iso(NOW - 6 * DAY),
});

const listing = (overrides: Partial<MarketListing> = {}): MarketListing => ({
  id: 1,
  sellerId: "ann",
  purchaseId: 1,
  itemId: "duck",
  price: 12,
  status: "open",
  at: iso(NOW - DAY),
  ...overrides,
});

const offer = (overrides: Partial<MarketOffer> = {}): MarketOffer => ({
  id: 1,
  listingId: 1,
  buyerId: "bob",
  amount: 8,
  status: "pending",
  at: iso(NOW - DAY / 2),
  ...overrides,
});

const sale = (overrides: Partial<MarketSale> = {}): MarketSale => ({
  id: 1,
  listingId: 1,
  sellerId: "ann",
  buyerId: "bob",
  itemId: "duck",
  price: 12,
  sourcePurchaseId: 1,
  buyerPurchaseId: 2,
  at: iso(NOW - DAY / 4),
  ...overrides,
});

function data(
  market: Partial<MarketData>,
  coins: Partial<CompetitionData["coins"]> = {},
  overrides: Partial<CompetitionData> = {},
): CompetitionData {
  return competitionData({
    players: [player("ann", "Ann"), player("bob", "Bob"), player("cat", "Cat")],
    features: { ...competitionData().features, marketplace: true },
    coins: coinData({
      items: [duck, crown, egg, hint, shield, skillTitle],
      adjustments: [grant(1, "ann", 20), grant(2, "bob", 20)],
      ...coins,
      market: { listings: [], offers: [], sales: [], ...market },
    }),
    ...overrides,
  });
}

function queries(d: CompetitionData) {
  const getWallet = (id: string, now = NOW) => deriveWallet(d, id, now);
  return {
    ...createCoinQueries(d),
    ...createMarketQueries(d, { getWallet }),
    getWallet,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("market rules", () => {
  it("prices between half and three times the shop price", () => {
    expect(marketPriceRange(duck)).toEqual({ min: 5, max: 30 });
    expect(marketPriceRange({ price: 1, crateOnly: false })).toEqual({
      min: 1,
      max: 3,
    });
  });

  it("gives egg exclusives a fixed range", () => {
    expect(marketPriceRange(egg)).toEqual({ min: 5, max: 60 });
  });

  it("trades wearables and spendable power-ups, not skill rewards or passives", () => {
    expect(isTradeable(duck)).toBe(true);
    expect(isTradeable(egg)).toBe(true);
    expect(isTradeable(hint)).toBe(true);
    expect(isTradeable(shield)).toBe(false);
    expect(isTradeable(skillTitle)).toBe(false);
  });
});

describe("listing and offer state", () => {
  it("expires an open listing by age", () => {
    const l = listing({ at: iso(NOW - MARKET_LISTING_MS) });
    expect(listingStatus(l, NOW)).toBe("expired");
    expect(listingStatus(l, NOW - 1)).toBe("open");
    expect(listingStatus(listing({ status: "sold" }), NOW)).toBe("sold");
  });

  it("lapses a pending offer with its listing", () => {
    expect(offerStatus(offer(), listing(), NOW)).toBe("pending");
    expect(offerStatus(offer(), listing({ status: "cancelled" }), NOW)).toBe(
      "expired",
    );
    expect(offerStatus(offer(), listing({ at: iso(NOW - 8 * DAY) }), NOW)).toBe(
      "expired",
    );
    expect(offerStatus(offer({ status: "declined" }), listing(), NOW)).toBe(
      "declined",
    );
  });

  it("holds coins only for live pending offers", () => {
    const market: MarketData = {
      listings: [listing(), listing({ id: 2, status: "sold" })],
      offers: [
        offer(),
        offer({ id: 2, listingId: 2, amount: 5 }),
        offer({ id: 3, amount: 4, status: "withdrawn" }),
      ],
      sales: [],
    };
    expect(heldCoins(market, "bob", NOW)).toBe(8);
    expect(heldCoins(market, "ann", NOW)).toBe(0);
  });
});

describe("wallet with marketplace trades", () => {
  it("moves the price from buyer to seller and doesn't charge the free copy", () => {
    const d = data(
      { listings: [listing({ status: "sold" })], sales: [sale()] },
      {
        purchases: [purchase(1, "ann", "duck", 10), purchase(2, "bob", "duck")],
      },
    );
    const ann = deriveWallet(d, "ann", NOW);
    const bob = deriveWallet(d, "bob", NOW);
    expect(ann).toMatchObject({ traded: 12, spent: 10, balance: 22 });
    expect(bob).toMatchObject({ traded: -12, balance: 8 });
    expect(bob.ledger.map((e) => e.kind)).toContain("market-buy");
    expect(bob.ledger.some((e) => e.kind === "purchase")).toBe(false);
    expect(ann.ledger[0]).toMatchObject({
      kind: "market-sale",
      amount: 12,
      label: "Sold Duck to Bob on the market",
    });
  });

  it("takes held offers off what the buyer can spend", () => {
    const d = data(
      { listings: [listing()], offers: [offer()] },
      { purchases: [purchase(1, "ann", "duck", 10)] },
    );
    expect(deriveWallet(d, "bob", NOW)).toMatchObject({
      held: 8,
      balance: 12,
    });
  });
});

describe("ownership after a sale", () => {
  const sold = data(
    { listings: [listing({ status: "sold" })], sales: [sale()] },
    {
      purchases: [purchase(1, "ann", "duck", 10), purchase(2, "bob", "duck")],
      equipped: [{ playerId: "ann", slot: "pet", itemId: "duck" }],
    },
  );

  it("moves the item from the seller's inventory to the buyer's", () => {
    const q = queries(sold);
    expect(q.getInventory("ann")).toEqual([]);
    expect(q.getInventory("bob").map((i) => i.item.id)).toEqual(["duck"]);
    expect(soldPurchaseIds(sold.coins.market)).toEqual(new Set([1]));
  });

  it("stops the seller wearing what they sold", () => {
    expect(queries(sold).getLoadout("ann").pet).toBeUndefined();
  });

  it("still won't sell the seller another from the shop this season", () => {
    expect(queries(sold).getPurchaseBlock(duck, { playerId: "ann" })).toBe(
      "owned",
    );
  });
});

describe("while listed", () => {
  const listed = data(
    {
      listings: [
        listing({ purchaseId: 1 }),
        listing({ id: 2, purchaseId: 3, itemId: "hint", price: 6 }),
      ],
    },
    {
      purchases: [
        purchase(1, "ann", "duck", 10),
        purchase(3, "ann", "hint", 6),
      ],
      equipped: [{ playerId: "ann", slot: "pet", itemId: "duck" }],
    },
  );

  it("marks a listed wearable and stops it being worn", () => {
    const q = queries(listed);
    expect(q.getInventory("ann")).toContainEqual(
      expect.objectContaining({ item: duck, listingId: 1, equipped: false }),
    );
    expect(q.getLoadout("ann").pet).toBeUndefined();
  });

  it("takes a listed power-up charge out of use", () => {
    expect(queries(listed).getPowerUpPanel("ann").options).toEqual([]);
  });

  it("frees both once the listing lapses", () => {
    vi.setSystemTime(NOW + 7 * DAY);
    const q = queries(listed);
    expect(q.getLoadout("ann").pet?.id).toBe("duck");
    expect(q.getInventory("ann")).toContainEqual(
      expect.objectContaining({ item: hint, charges: 1 }),
    );
  });
});

describe("buying and offering", () => {
  const base = data(
    { listings: [listing()] },
    { purchases: [purchase(1, "ann", "duck", 10)] },
  );
  const view = (d: CompetitionData) =>
    queries(d).getMarketListing(1, undefined)!.view;

  it("lets another player in the season buy", () => {
    const q = queries(base);
    expect(q.getMarketBuyBlock(view(base), "bob")).toBeUndefined();
    expect(q.getMarketOfferBlock(view(base), "bob")).toBeUndefined();
  });

  it("blocks guests, the seller and anyone who already has one", () => {
    const owned = data(
      { listings: [listing()] },
      {
        purchases: [
          purchase(1, "ann", "duck", 10),
          purchase(5, "cat", "duck", 10),
        ],
      },
    );
    const q = queries(owned);
    expect(q.getMarketBuyBlock(view(owned), undefined)).toBe("guest");
    expect(q.getMarketBuyBlock(view(owned), "ann")).toBe("own-listing");
    expect(q.getMarketBuyBlock(view(owned), "cat")).toBe("owned");
  });

  it("blocks a second charge of the same power-up", () => {
    const d = data(
      { listings: [listing({ itemId: "hint", price: 6 })] },
      {
        purchases: [
          purchase(1, "ann", "hint", 6),
          purchase(5, "bob", "hint", 6),
        ],
      },
    );
    expect(queries(d).getMarketBuyBlock(view(d), "bob")).toBe("owned");
  });

  it("blocks what the buyer can't afford, counting their offer on it", () => {
    const poor = data(
      { listings: [listing({ price: 25 })], offers: [offer({ amount: 6 })] },
      { purchases: [purchase(1, "ann", "duck", 10)] },
    );
    const q = queries(poor);
    // 20 coins, 6 held on this listing: 20 can go on it, not 25.
    expect(q.getMarketBuyBlock(view(poor), "bob")).toBe("unaffordable");
    expect(q.getMarketOfferBlock(view(poor), "bob")).toBeUndefined();
  });

  it("closes the market behind the flag and once a listing lapses", () => {
    const off = data(
      { listings: [listing()] },
      { purchases: [purchase(1, "ann", "duck", 10)] },
      { features: competitionData().features },
    );
    expect(queries(off).getMarketBuyBlock(view(off), "bob")).toBe("disabled");
    vi.setSystemTime(NOW + 7 * DAY);
    expect(
      queries(base).getMarketBuyBlock(view(base), "bob", NOW + 7 * DAY),
    ).toBe("closed");
  });

  it("takes no offers on a listing at the floor price", () => {
    const floor = data(
      { listings: [listing({ price: 5 })] },
      { purchases: [purchase(1, "ann", "duck", 10)] },
    );
    expect(queries(floor).getMarketOfferBlock(view(floor), "bob")).toBe(
      "no-offers",
    );
  });

  it("shows the seller live offers, highest first, and nobody else", () => {
    const d = data(
      {
        listings: [listing()],
        offers: [offer(), offer({ id: 2, buyerId: "cat", amount: 10 })],
      },
      { purchases: [purchase(1, "ann", "duck", 10)] },
    );
    const q = queries(d);
    expect(q.getMarketListing(1, "ann")!.offers.map((o) => o.offer.id)).toEqual(
      [2, 1],
    );
    expect(q.getMarketListing(1, "bob")!.offers).toEqual([]);
    expect(q.getMarketListing(1, "bob")!.myOffer?.offer.id).toBe(1);
  });
});

describe("browsing", () => {
  const d = data(
    {
      listings: [
        listing(),
        listing({ id: 2, purchaseId: 2, itemId: "crown", price: 4 }),
        listing({
          id: 3,
          purchaseId: 3,
          status: "cancelled",
          closedAt: iso(NOW),
        }),
      ],
    },
    {
      purchases: [
        purchase(1, "ann", "duck", 10),
        purchase(2, "bob", "crown", 8),
        purchase(3, "cat", "duck", 10),
      ],
    },
  );

  it("lists open listings newest first, filtered and sorted", () => {
    const q = queries(d);
    expect(q.getMarketListings().map((v) => v.listing.id)).toEqual([2, 1]);
    expect(
      q.getMarketListings({ sort: "price-desc" }).map((v) => v.listing.id),
    ).toEqual([1, 2]);
    expect(
      q.getMarketListings({ category: "cosmetic" }).map((v) => v.listing.id),
    ).toEqual([2]);
  });

  it("lists every listing for admins", () => {
    expect(
      queries(d)
        .getAllMarketListings()
        .map((v) => v.status),
    ).toEqual(["cancelled", "open", "open"]);
  });
});

describe("what a player can list", () => {
  it("explains why a copy can't go on sale", () => {
    const d = data(
      {},
      {
        purchases: [
          purchase(1, "ann", "duck", 10),
          purchase(2, "ann", "shield", 6),
          purchase(3, "ann", "skill-title"),
          purchase(4, "ann", "hint", 6),
        ],
        uses: [
          {
            id: 1,
            purchaseId: 4,
            playerId: "ann",
            taskId: "week-01",
            effect: "hint",
            at: iso(NOW - DAY),
          },
        ],
      },
    );
    const byItem = Object.fromEntries(
      queries(d)
        .getListableItems("ann")
        .map((l) => [l.item.id, l.blocked ?? "ok"]),
    );
    expect(byItem).toEqual({
      duck: "ok",
      shield: "untradeable",
      "skill-title": "untradeable",
      hint: "spent",
    });
  });

  it("can't list anything once the season is closed", () => {
    const d = data(
      {},
      { purchases: [purchase(1, "ann", "duck", 10)] },
      { season: season({ status: "closed" }) },
    );
    expect(queries(d).getListableItems("ann")[0].blocked).toBe("season-closed");
  });
});

describe("market notifications", () => {
  const feed = (d: CompetitionData, playerId: string, now = NOW) =>
    createNotificationQueries(d, { getPlayerRankHistory: () => [] })
      .getNotifications({ playerId, now })
      .items.filter(
        (i) =>
          i.kind.startsWith("market") ||
          i.kind.includes("offer") ||
          i.kind === "listing-expired",
      )
      .map((i) => [i.kind, i.title]);

  it("tells the seller about offers and sales", () => {
    const d = data({
      listings: [listing({ status: "sold" })],
      offers: [offer({ status: "declined", decidedAt: iso(NOW - DAY / 4) })],
      sales: [sale({ buyerId: "cat" })],
    });
    expect(feed(d, "ann")).toEqual([
      ["market-sold", "Cat bought your Duck for 12 Clim Coin"],
      ["market-offer", "Bob offered 8 Clim Coin for your Duck"],
    ]);
    expect(feed(d, "bob")).toEqual([
      ["offer-declined", "Your offer for Duck was declined"],
    ]);
  });

  it("tells the seller when a listing lapses unsold", () => {
    const d = data({ listings: [listing({ at: iso(NOW - 8 * DAY) })] });
    expect(feed(d, "ann")).toEqual([
      ["listing-expired", "Your Duck listing expired unsold"],
    ]);
  });

  it("stays quiet while the market is off", () => {
    const d = data(
      { listings: [listing()], offers: [offer()] },
      {},
      { features: competitionData().features },
    );
    expect(feed(d, "ann")).toEqual([]);
  });
});
