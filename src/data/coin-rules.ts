import type {
  ActivePowerUpKind,
  CoinRules,
  Crate,
  CrateTierKind,
  CosmeticKind,
  LoadoutSlot,
  NameColour,
  PassivePowerUpKind,
  PowerUpKind,
  WishPowerUpKind,
  ProfileTheme,
  Rarity,
  ShopCategory,
} from "../types";
import { wallClockToIso } from "../lib/time";

// Every Clim Coin number in one place, free of database imports so the
// score, prediction and notification derivations (and `/rules`) can share
// them. See `coins.ts` for how they're applied.

/** Coins paid out per published week, by finishing position. */
export const PLACEMENT_COINS = {
  first: 10,
  second: 7,
  third: 5,
  /** Everyone else with a recorded score that week. */
  scored: 2,
} as const;

/** Coins for submitting at least one entry on a week (paid at the deadline). */
export const ENTRY_COINS = 2;
/** Coins for voting in a poll (paid when it closes). */
export const POLL_VOTE_COINS = 1;
/** Coins for a People's Choice vote (paid when voting closes). */
export const PEOPLES_CHOICE_VOTE_COINS = 1;
/** Coins for calling a week's winner (paid when the call locks). */
export const PREDICTION_COINS = 1;

/** Golden Week multiplies the week's task score, rounded up. */
export const GOLDEN_WEEK_MULTIPLIER = 1.5;
/** A correct call backed with Double Down pays this instead of +1. */
export const DOUBLE_DOWN_POINTS = 2;
/** Points a Sabotage takes from its target (a deduction). */
export const SABOTAGE_POINTS = -5;

/** The most coins a player can gift in any rolling 7 days. */
export const GIFT_WEEKLY_CAP = 5;
export const GIFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const GIFT_MESSAGE_MAX = 80;

/** Golden Week's boost to a week's points, rounded up (never deepens a loss). */
export function goldenWeekPoints(points: number): number {
  return points > 0 ? Math.ceil(points * GOLDEN_WEEK_MULTIPLIER) : points;
}

export const COIN_RULES: CoinRules = {
  placement: { ...PLACEMENT_COINS },
  entry: ENTRY_COINS,
  pollVote: POLL_VOTE_COINS,
  peoplesChoiceVote: PEOPLES_CHOICE_VOTE_COINS,
  prediction: PREDICTION_COINS,
  goldenWeekMultiplier: GOLDEN_WEEK_MULTIPLIER,
  doubleDownPoints: DOUBLE_DOWN_POINTS,
  sabotagePoints: -SABOTAGE_POINTS,
  giftWeeklyCap: GIFT_WEEKLY_CAP,
};

export const SHOP_CATEGORIES = [
  "pet",
  "avatar",
  "cosmetic",
  "power_up",
] as const satisfies readonly ShopCategory[];

export const COSMETIC_KINDS = [
  "title",
  "name_colour",
  "theme",
] as const satisfies readonly CosmeticKind[];

export const LOADOUT_SLOTS = [
  "pet",
  "avatar",
  "title",
  "name_colour",
  "theme",
] as const satisfies readonly LoadoutSlot[];

export const NAME_COLOURS = [
  "acid",
  "amber",
  "magenta",
  "cyan",
  "gold",
  "pumpkin",
  "glitch",
  "rainbow",
] as const satisfies readonly NameColour[];

export const PROFILE_THEMES = [
  "phosphor",
  "amber",
  "synthwave",
  "ice",
  "matrix",
  "vaporwave",
  "blueprint",
] as const satisfies readonly ProfileTheme[];

/** Power-ups spent on a live week from the wallet. */
export const ACTIVE_POWER_UP_KINDS = [
  "double_down",
  "hint",
  "golden_week",
  "sabotage",
] as const satisfies readonly ActivePowerUpKind[];

/** Power-ups that work by themselves once bought. */
export const PASSIVE_POWER_UP_KINDS = [
  "shield",
  "mirror",
  "insurance",
] as const satisfies readonly PassivePowerUpKind[];

/** The One Wish Willow's effect: spent by making a wish, not on a week. */
export const WISH_POWER_UP: WishPowerUpKind = "wish";
/** The longest wish (and Taskmaster's reply), in characters. */
export const WISH_MAX = 200;

export const POWER_UP_KINDS = [
  ...ACTIVE_POWER_UP_KINDS,
  ...PASSIVE_POWER_UP_KINDS,
  WISH_POWER_UP,
] as const satisfies readonly PowerUpKind[];

export const isActivePowerUp = (kind: PowerUpKind): kind is ActivePowerUpKind =>
  ACTIVE_POWER_UP_KINDS.some((k) => k === kind);

// ── Sale windows (limited-time stock and seasonal eggs) ───────────────

/** Whether a sale window (ISO instants, either end open) includes `now`. */
export function inSaleWindow(
  window: { availableFrom?: string; availableUntil?: string },
  now: number,
): boolean {
  const from = window.availableFrom
    ? new Date(window.availableFrom).getTime()
    : -Infinity;
  const until = window.availableUntil
    ? new Date(window.availableUntil).getTime()
    : Infinity;
  return from <= now && now < until;
}

// ── Crates (lootboxes, shown to players as eggs) ───────────────────────────────────────────────

export const RARITIES = [
  "common",
  "rare",
  "epic",
  "legendary",
] as const satisfies readonly Rarity[];

/** The lowest price of each rarity tier, from rarest down. */
const RARITY_FLOORS: [Rarity, number][] = [
  ["legendary", 20],
  ["epic", 15],
  ["rare", 8],
  ["common", 0],
];

/** An item's rarity, from its price: ≤7 common, 8–14 rare, 15–19 epic, 20+ legendary. */
export function rarityOf(price: number): Rarity {
  return RARITY_FLOORS.find(([, floor]) => price >= floor)?.[0] ?? "common";
}

/** Every tier a crate can roll, rarest wearables first, then power-ups. */
export const CRATE_TIER_KINDS = [
  ...RARITIES,
  "power_up",
] as const satisfies readonly CrateTierKind[];

/**
 * The shop categories in a crate's rarity tiers. Power-ups drop separately,
 * through the crate's small `powerUpChance`.
 */
export const CRATE_CATEGORIES = [
  "pet",
  "avatar",
  "cosmetic",
] as const satisfies readonly ShopCategory[];

/**
 * The crates on sale, which players see as eggs to crack open. With the
 * starter catalogue a Mystery Egg roll is worth about 9 coins and a
 * Fabergé one about 13, so the cheap egg is slightly better value than
 * buying outright, but you don't get to choose. Each egg's pixel art lives
 * in `public/shop/eggs/<id>.svg`, with `-top` / `-bottom` halves for the
 * cracking animation.
 */
export const CRATES: readonly Crate[] = [
  {
    id: "mystery-egg",
    name: "Mystery Egg",
    description:
      "Hatches a random pet, avatar or cosmetic you don't own yet. Anything can come out, very occasionally even a power-up.",
    price: 8,
    odds: { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 },
    powerUpChance: 0.02,
  },
  {
    id: "faberge-egg",
    name: "Fabergé Egg",
    description:
      "No commons: rare or better, with five times the legendary odds and a better shot at a power-up.",
    price: 15,
    odds: { rare: 0.55, epic: 0.35, legendary: 0.1 },
    powerUpChance: 0.05,
  },
  // Seasonal eggs: on sale for a limited time, and they hatch only their own
  // exclusives (items whose `crateId` names them), which no other egg drops.
  // Times are UK wall-clock.
  {
    id: "halloween-egg",
    name: "Haunted Egg",
    description:
      "Halloween only. Hatches spooky exclusives you can't get anywhere else, and it's gone after the 31st.",
    price: 10,
    odds: { common: 0.5, rare: 0.3, epic: 0.15, legendary: 0.05 },
    powerUpChance: 0.03,
    exclusive: true,
    availableFrom: wallClockToIso("2026-10-21 00:00"),
    availableUntil: wallClockToIso("2026-10-31 23:59:59"),
  },
];

/** The crates on sale at `now` (seasonal eggs only in their window). */
export const cratesOnSale = (now: number): Crate[] =>
  CRATES.filter((crate) => inSaleWindow(crate, now));

/** An egg's pixel art: whole, and the two halves it cracks into. */
export const eggArt = (crate: Pick<Crate, "id">) => ({
  whole: `/shop/eggs/${crate.id}.svg`,
  top: `/shop/eggs/${crate.id}-top.svg`,
  bottom: `/shop/eggs/${crate.id}-bottom.svg`,
});

export const getCrate = (id: string): Crate | undefined =>
  CRATES.find((crate) => crate.id === id);
