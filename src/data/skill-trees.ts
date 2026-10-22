import type {
  Crate,
  NameColour,
  PowerUpKind,
  Rarity,
  SkillNode,
  SkillPath,
  SkillPathId,
  SkillPerk,
  SkillPerks,
  ShopCategory,
  SkillUnlock,
} from "../types";
import { RARITIES } from "./coin-rules";

// Skill trees: themed pathways a player commits to once a season and
// unlocks node by node with Clim Coin. The catalogue lives here, in code
// (like the eggs in `coin-rules.ts`); only unlocks are stored. Perks only
// ever touch Clim Coin (earnings, discounts, the gift cap and egg odds),
// never leaderboard points, and are applied when the wallet is derived or
// when a purchase is priced.

/** Prices by tier: a root, two branches and a capstone (36 for a full tree). */
export const SKILL_TIER_PRICES = { 1: 5, 2: 8, 3: 15 } as const;

/**
 * A skill-only shop item a node grants. Written to `shop_items` by the
 * migration and the seed, so ownership and equipping work like any item.
 */
export interface SkillRewardItem {
  id: string;
  name: string;
  description: string;
  cosmeticKind: "title" | "name_colour";
  cosmeticValue: string;
}

const title = (
  id: string,
  text: string,
  pathName: string,
): SkillRewardItem => ({
  id,
  name: `Title: ${text}`,
  description: `${pathName} skill tree title. Can't be bought.`,
  cosmeticKind: "title",
  cosmeticValue: text,
});

const colour = (
  id: string,
  name: string,
  value: NameColour,
  pathName: string,
): SkillRewardItem => ({
  id,
  name,
  description: `${pathName} capstone name colour. Can't be bought.`,
  cosmeticKind: "name_colour",
  cosmeticValue: value,
});

export const SKILL_REWARD_ITEMS: readonly SkillRewardItem[] = [
  title("skill-title-stormbrewer", "Stormbrewer", "Stormbrewer"),
  colour("skill-colour-storm", "Storm Name", "storm", "Stormbrewer"),
  title("skill-title-elite-hacker", "Elite Hacker", "Elite Hacker"),
  colour("skill-colour-hacker", "Hacker Name", "hacker", "Elite Hacker"),
  title("skill-title-friendkeeper", "Friendkeeper", "Friendkeeper"),
  colour(
    "skill-colour-friendship",
    "Friendship Name",
    "friendship",
    "Friendkeeper",
  ),
  title("skill-title-overachiever", "Overachiever", "Overachiever"),
  colour("skill-colour-platinum", "Platinum Name", "platinum", "Overachiever"),
  title(
    "skill-title-cartographer",
    "Elephant Cartographer",
    "Elephant Cartographer",
  ),
  colour(
    "skill-colour-cartographer",
    "Cartographer Name",
    "cartographer",
    "Elephant Cartographer",
  ),
];

/** Builds a pathway's four nodes: root → two branches → capstone. */
function tree(
  pathId: SkillPathId,
  nodes: {
    root: Omit<SkillNode, "pathId" | "tier" | "price" | "requires">;
    perk: Omit<SkillNode, "pathId" | "tier" | "price" | "requires">;
    cosmetic: Omit<SkillNode, "pathId" | "tier" | "price" | "requires">;
    capstone: Omit<SkillNode, "pathId" | "tier" | "price" | "requires">;
  },
): SkillNode[] {
  const { root, perk, cosmetic, capstone } = nodes;
  return [
    { ...root, pathId, tier: 1, price: SKILL_TIER_PRICES[1], requires: [] },
    {
      ...perk,
      pathId,
      tier: 2,
      price: SKILL_TIER_PRICES[2],
      requires: [root.id],
    },
    {
      ...cosmetic,
      pathId,
      tier: 2,
      price: SKILL_TIER_PRICES[2],
      requires: [root.id],
    },
    {
      ...capstone,
      pathId,
      tier: 3,
      price: SKILL_TIER_PRICES[3],
      requires: [perk.id, cosmetic.id],
    },
  ];
}

// Perk shorthands, so the trees below read as a table.
const earn = (
  source: Extract<SkillPerk, { kind: "earn_bonus" }>["source"],
  amount = 1,
): SkillPerk => ({ kind: "earn_bonus", source, amount });
const powerUpsOff = (amount: number, powerUps?: PowerUpKind[]): SkillPerk => ({
  kind: "power_up_discount",
  amount,
  ...(powerUps && { powerUps }),
});
const WEARABLES: ShopCategory[] = ["pet", "avatar", "cosmetic"];

/**
 * The pathways. They're balanced on one scale: over a season a committed
 * player has roughly 10 of each weekly event (entries, scored weeks, winner
 * calls, People's Choice votes), 5 poll votes, 4 power-ups used and about 5
 * purchases of each kind they discount. On that scale each tier is worth
 * about the same on every pathway (root ~14, branches ~16 and ~10 plus a
 * title, capstone ~24 plus a name colour: ~64 coins for a 36-coin tree).
 * `skill-trees.test.ts` checks it.
 */
export const SKILL_PATHS: readonly SkillPath[] = [
  {
    id: "stormbrewer",
    name: "Stormbrewer",
    inspiredBy: "the storm that is brewing for Luke",
    motto: "a storm is brewing",
    description:
      "Power-ups and chaos. Much cheaper power-ups, big payouts for every one you unleash, and a name that crackles with lightning.",
    accent: "cyan",
    nodes: tree("stormbrewer", {
      root: {
        id: "storm-static-charge",
        name: "Static Charge",
        description: "The air hums before the first strike.",
        perks: [powerUpsOff(2), earn("power-up-use")],
      },
      perk: {
        id: "storm-lightning-rod",
        name: "Lightning Rod",
        description: "Every bolt you throw comes back charged.",
        perks: [
          earn("power-up-use", 3),
          powerUpsOff(2, ["golden_week", "sabotage"]),
        ],
      },
      cosmetic: {
        id: "storm-thunderhead",
        name: "Thunderhead",
        description: "You always see the weather coming.",
        perks: [earn("prediction")],
        rewardItemId: "skill-title-stormbrewer",
      },
      capstone: {
        id: "storm-eye-of-the-hurricane",
        name: "Eye of the Hurricane",
        description: "Calm at the centre, chaos all around.",
        perks: [powerUpsOff(2), earn("placement"), earn("power-up-use")],
        rewardItemId: "skill-colour-storm",
      },
    }),
  },
  {
    id: "elite-hacker",
    name: "Elite Hacker",
    inspiredBy: "Ctrl Alt Elite",
    motto: "sudo make me a winner",
    description:
      "Insider knowledge. Coins for every winner call, a Taskmaster's Hint that ends up free, and a name straight out of a green-screen terminal.",
    accent: "acid",
    nodes: tree("elite-hacker", {
      root: {
        id: "hacker-sudo",
        name: "sudo",
        description: "Elevated privileges, elevated predictions.",
        perks: [earn("prediction"), powerUpsOff(4, ["hint"])],
      },
      perk: {
        id: "hacker-packet-sniffer",
        name: "Packet Sniffer",
        description: "You read the results before they're sent.",
        perks: [
          earn("prediction"),
          powerUpsOff(4, ["double_down"]),
          powerUpsOff(2, ["hint"]),
        ],
      },
      cosmetic: {
        id: "hacker-root-access",
        name: "Root Access",
        description: 'git commit -m "every single week"',
        perks: [earn("entry")],
        rewardItemId: "skill-title-elite-hacker",
      },
      capstone: {
        id: "hacker-zero-day",
        name: "Zero Day",
        description: "An exploit nobody saw coming.",
        perks: [
          earn("prediction"),
          earn("placement"),
          powerUpsOff(2, ["hint", "sabotage"]),
        ],
        rewardItemId: "skill-colour-hacker",
      },
    }),
  },
  {
    id: "friendkeeper",
    name: "Friendkeeper",
    inspiredBy: "Team Friendship",
    motto: "friendship is magic",
    description:
      "Community. Coins for every vote you cast, three times the weekly gift limit, and a name full of warmth.",
    accent: "magenta",
    nodes: tree("friendkeeper", {
      root: {
        id: "friend-plus-one",
        name: "Plus One",
        description: "Always turns up, always has a say.",
        perks: [
          earn("peoples-choice-vote"),
          earn("poll-vote"),
          { kind: "gift_cap", amount: 3 },
        ],
      },
      perk: {
        id: "friend-group-chat",
        name: "Group Chat",
        description: "Someone has to keep the conversation going.",
        perks: [
          earn("peoples-choice-vote"),
          earn("poll-vote"),
          { kind: "gift_cap", amount: 2 },
        ],
      },
      cosmetic: {
        id: "friend-bff",
        name: "BFF",
        description: "Backing your friends to win.",
        perks: [earn("prediction")],
        rewardItemId: "skill-title-friendkeeper",
      },
      capstone: {
        id: "friend-friendship-is-magic",
        name: "Friendship Is Magic",
        description: "Everyone does better together.",
        perks: [
          earn("entry"),
          earn("placement"),
          earn("poll-vote"),
          { kind: "gift_cap", amount: 5 },
        ],
        rewardItemId: "skill-colour-friendship",
      },
    }),
  },
  {
    id: "overachiever",
    name: "Overachiever",
    inspiredBy: "The Achievers",
    motto: "consistently above average",
    description:
      "Turning up pays. Extra coins for every entry, every scored week and every vote, cheap safety nets, and a polished platinum name.",
    accent: "gold",
    nodes: tree("overachiever", {
      root: {
        id: "achiever-gold-star",
        name: "Gold Star",
        description: "Full marks for showing up.",
        perks: [earn("entry"), earn("poll-vote")],
      },
      perk: {
        id: "achiever-extra-credit",
        name: "Extra Credit",
        description: "Every result counts, and you've got a backup plan.",
        perks: [
          earn("placement"),
          powerUpsOff(3, ["insurance", "golden_week"]),
        ],
      },
      cosmetic: {
        id: "achiever-teachers-pet",
        name: "Teacher's Pet",
        description: "First to vote, every time.",
        perks: [earn("peoples-choice-vote")],
        rewardItemId: "skill-title-overachiever",
      },
      capstone: {
        id: "achiever-valedictorian",
        name: "Valedictorian",
        description: "Top of the class, and it shows.",
        perks: [earn("entry"), earn("placement"), earn("poll-vote")],
        rewardItemId: "skill-colour-platinum",
      },
    }),
  },
  {
    id: "elephant-cartographer",
    name: "Elephant Cartographer",
    inspiredBy: "Team Star Elephant Diagram",
    motto: "here be elephants",
    description:
      "Mapping the shop. Cheaper eggs, pets, avatars and cosmetics, luckier hatches, and a name inked like an old treasure map.",
    accent: "amber",
    nodes: tree("elephant-cartographer", {
      root: {
        id: "cartographer-field-notes",
        name: "Field Notes",
        description: "Every stall in the shop, mapped and priced.",
        perks: [
          { kind: "egg_discount", amount: 1 },
          { kind: "shop_discount", amount: 1, categories: WEARABLES },
          earn("poll-vote"),
        ],
      },
      perk: {
        id: "cartographer-treasure-map",
        name: "Treasure Map",
        description: "X marks the rarer spot.",
        perks: [
          earn("entry"),
          { kind: "egg_luck", amount: 0.1 },
          { kind: "egg_discount", amount: 1 },
        ],
      },
      cosmetic: {
        id: "cartographer-never-forgets",
        name: "Never Forgets",
        description: "An elephant remembers who's in form.",
        perks: [earn("prediction")],
        rewardItemId: "skill-title-cartographer",
      },
      capstone: {
        id: "cartographer-here-be-dragons",
        name: "Here Be Dragons",
        description: "The edge of the map, and beyond.",
        perks: [
          earn("placement"),
          earn("poll-vote"),
          { kind: "egg_discount", amount: 1 },
          { kind: "shop_discount", amount: 1, categories: WEARABLES },
        ],
        rewardItemId: "skill-colour-cartographer",
      },
    }),
  },
];

export const SKILL_PATH_IDS = SKILL_PATHS.map((p) => p.id);

const nodeById = new Map(
  SKILL_PATHS.flatMap((path) => path.nodes.map((node) => [node.id, node])),
);

export const getSkillPath = (id: string): SkillPath | undefined =>
  SKILL_PATHS.find((path) => path.id === id);

export const getSkillNode = (id: string): SkillNode | undefined =>
  nodeById.get(id);

export const isSkillPathId = (id: string): id is SkillPathId =>
  SKILL_PATHS.some((path) => path.id === id);

/** A pathway's nodes grouped by tier, root first. */
export const nodesByTier = (path: SkillPath): SkillNode[][] =>
  ([1, 2, 3] as const)
    .map((tier) => path.nodes.filter((node) => node.tier === tier))
    .filter((nodes) => nodes.length > 0);

export const pathCost = (path: SkillPath): number =>
  path.nodes.reduce((sum, node) => sum + node.price, 0);

const instant = (iso: string) => new Date(iso).getTime();

/**
 * A player's unlocked nodes, optionally only those unlocked by `at` (an
 * instant), so an earning perk never pays for coins that landed before it.
 */
export function unlockedNodes(
  unlocks: readonly SkillUnlock[],
  playerId: string,
  at?: number,
): SkillNode[] {
  return unlocks.flatMap((u) => {
    if (u.playerId !== playerId) return [];
    if (at !== undefined && instant(u.at) > at) return [];
    const node = getSkillNode(u.nodeId);
    return node ? [node] : [];
  });
}

/** Adds up the perks of `nodes`. */
export function aggregatePerks(nodes: readonly SkillNode[]): SkillPerks {
  const perks: SkillPerks = {
    earn: {},
    powerUpDiscount: 0,
    powerUpDiscounts: {},
    shopDiscounts: {},
    eggDiscount: 0,
    eggLuck: 0,
    giftCap: 0,
  };
  const add = (perk: SkillPerk) => {
    switch (perk.kind) {
      case "earn_bonus":
        perks.earn[perk.source] = (perks.earn[perk.source] ?? 0) + perk.amount;
        return;
      case "power_up_discount":
        if (perk.powerUps) {
          for (const effect of perk.powerUps) {
            perks.powerUpDiscounts[effect] =
              (perks.powerUpDiscounts[effect] ?? 0) + perk.amount;
          }
        } else {
          perks.powerUpDiscount += perk.amount;
        }
        return;
      case "shop_discount":
        for (const category of perk.categories) {
          perks.shopDiscounts[category] =
            (perks.shopDiscounts[category] ?? 0) + perk.amount;
        }
        return;
      case "egg_discount":
        perks.eggDiscount += perk.amount;
        return;
      case "egg_luck":
        perks.eggLuck += perk.amount;
        return;
      case "gift_cap":
        perks.giftCap += perk.amount;
        return;
    }
  };
  for (const node of nodes) node.perks.forEach(add);
  return perks;
}

/** A player's perks now (or as of the instant `at`). */
export const skillPerksFor = (
  unlocks: readonly SkillUnlock[],
  playerId: string,
  at?: number,
): SkillPerks => aggregatePerks(unlockedNodes(unlocks, playerId, at));

/** What a shop item costs a player with `perks`. */
export function discountedPrice(
  item: { price: number; category: ShopCategory; powerUp?: PowerUpKind },
  perks: SkillPerks,
): number {
  const off = item.powerUp
    ? perks.powerUpDiscount + (perks.powerUpDiscounts[item.powerUp] ?? 0)
    : (perks.shopDiscounts[item.category] ?? 0);
  return Math.max(0, item.price - off);
}

/** What an egg costs a player with `perks`. */
export const eggPrice = (crate: Pick<Crate, "price">, perks: SkillPerks) =>
  Math.max(0, crate.price - perks.eggDiscount);

/**
 * `crate` with `luck` (out of 1) of its odds moved from its commonest tier
 * to the next tier up. The odds still add up to the same total.
 */
export function luckyCrate(crate: Crate, luck: number): Crate {
  if (luck <= 0) return crate;
  const tiers = RARITIES.filter((r) => (crate.odds[r] ?? 0) > 0);
  const from = tiers[0];
  const to: Rarity | undefined = from
    ? RARITIES[RARITIES.indexOf(from) + 1]
    : undefined;
  if (!from || !to) return crate;
  const moved = Math.min(luck, crate.odds[from] ?? 0);
  return {
    ...crate,
    odds: {
      ...crate.odds,
      [from]: (crate.odds[from] ?? 0) - moved,
      [to]: (crate.odds[to] ?? 0) + moved,
    },
  };
}
