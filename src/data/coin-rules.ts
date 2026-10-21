import type {
  CoinRules,
  Crate,
  CosmeticKind,
  LoadoutSlot,
  NameColour,
  PowerUpKind,
  ProfileTheme,
  Rarity,
  ShopCategory,
} from "../types";

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
] as const satisfies readonly NameColour[];

export const PROFILE_THEMES = [
  "phosphor",
  "amber",
  "synthwave",
  "ice",
] as const satisfies readonly ProfileTheme[];

export const POWER_UP_KINDS = [
  "double_down",
  "hint",
  "golden_week",
  "sabotage",
] as const satisfies readonly PowerUpKind[];

// ── Crates (lootboxes, shown to players as eggs) ───────────────────────────────────────────────

export const RARITIES = [
  "common",
  "rare",
  "epic",
  "legendary",
] as const satisfies readonly Rarity[];

/** The lowest price of each rarity tier, from rarest down. */
const RARITY_FLOORS: [Rarity, number][] = [
  ["legendary", 40],
  ["epic", 30],
  ["rare", 16],
  ["common", 0],
];

/** An item's rarity, from its price: ≤15 common, 16–29 rare, 30–39 epic, 40+ legendary. */
export function rarityOf(price: number): Rarity {
  return RARITY_FLOORS.find(([, floor]) => price >= floor)?.[0] ?? "common";
}

/** The shop categories crates can drop (power-ups never do). */
export const CRATE_CATEGORIES = [
  "pet",
  "avatar",
  "cosmetic",
] as const satisfies readonly ShopCategory[];

/**
 * The crates on sale, which players see as eggs to crack open. With the
 * starter catalogue a Mystery Egg roll is worth about 18 coins and a
 * Fabergé one about 27, so the cheap egg is slightly better value than
 * buying outright, but you don't get to choose. Each egg's pixel art lives
 * in `public/shop/eggs/<id>.svg`, with `-top` / `-bottom` halves for the
 * cracking animation.
 */
export const CRATES: readonly Crate[] = [
  {
    id: "mystery-egg",
    name: "Mystery Egg",
    description:
      "Hatches a random pet, avatar or cosmetic you don't own yet. Anything can come out.",
    price: 15,
    odds: { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 },
  },
  {
    id: "faberge-egg",
    name: "Fabergé Egg",
    description:
      "No commons: rare or better, with five times the legendary odds.",
    price: 30,
    odds: { rare: 0.55, epic: 0.35, legendary: 0.1 },
  },
];

/** An egg's pixel art: whole, and the two halves it cracks into. */
export const eggArt = (crate: Pick<Crate, "id">) => ({
  whole: `/shop/eggs/${crate.id}.svg`,
  top: `/shop/eggs/${crate.id}-top.svg`,
  bottom: `/shop/eggs/${crate.id}-bottom.svg`,
});

export const getCrate = (id: string): Crate | undefined =>
  CRATES.find((crate) => crate.id === id);
