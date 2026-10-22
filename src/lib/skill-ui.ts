// Display config for skill trees: classes and copy keyed by the domain
// unions, so pages and components map variants through one typed table.
import type {
  PowerUpKind,
  ShopCategory,
  SkillBlock,
  SkillEarnSource,
  SkillOutcome,
  SkillPath,
  SkillPerk,
  SkillPerks,
} from "../types";
import { POWER_UP_INFO } from "../data/coins";

/** Each pathway accent's text, border and fill utilities. */
export const SKILL_ACCENT_CLASS: Record<
  SkillPath["accent"],
  { text: string; border: string; fill: string }
> = {
  acid: { text: "text-acid", border: "border-acid/50", fill: "bg-acid/10" },
  amber: { text: "text-amber", border: "border-amber/50", fill: "bg-amber/10" },
  magenta: {
    text: "text-magenta",
    border: "border-magenta/50",
    fill: "bg-magenta/10",
  },
  cyan: { text: "text-cyan", border: "border-cyan/50", fill: "bg-cyan/10" },
  gold: { text: "text-gold", border: "border-gold/50", fill: "bg-gold/10" },
};

/** What a skill node says instead of its unlock button. */
export const SKILL_BLOCK_LABEL: Record<SkillBlock, string> = {
  guest: "sign in to unlock",
  "season-closed": "season closed",
  unlocked: "✓ unlocked",
  "other-path": "another pathway",
  locked: "locked",
  unaffordable: "not enough coins",
};

/** The notice shown after unlocking a skill node redirects back. */
export const SKILL_OUTCOME_NOTICE: Record<
  SkillOutcome,
  { tone: "success" | "error"; message: string }
> = {
  unlocked: { tone: "success", message: "Skill unlocked!" },
  unaffordable: {
    tone: "error",
    message: "You don't have enough Clim Coin for that skill.",
  },
  locked: {
    tone: "error",
    message: "Unlock the skills before it in the tree first.",
  },
  owned: { tone: "error", message: "You've already unlocked that skill." },
  "other-path": {
    tone: "error",
    message: "You've committed to another pathway this season.",
  },
  "season-closed": {
    tone: "error",
    message: "This season is closed, so its skill trees are frozen.",
  },
  unavailable: { tone: "error", message: "Skill trees aren't open right now." },
  invalid: { tone: "error", message: "That didn't work. Try again." },
};

const SKILL_OUTCOMES = new Set(Object.keys(SKILL_OUTCOME_NOTICE));

/** The outcome named in a `?skills=` param, if it's a real one. */
export function parseSkillOutcome(
  value: string | null,
): SkillOutcome | undefined {
  return value && SKILL_OUTCOMES.has(value)
    ? (value as SkillOutcome)
    : undefined;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "a", "a and b", "a, b and c". */
const listOf = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const EARN_LABEL: Record<SkillEarnSource, string> = {
  placement: "per scored week",
  entry: "per entry submitted",
  prediction: "per winner call",
  "poll-vote": "per poll vote",
  "peoples-choice-vote": "per People's Choice vote",
  "power-up-use": "per power-up used",
};

const CATEGORY_LABEL: Record<ShopCategory, string> = {
  pet: "pets",
  avatar: "avatars",
  cosmetic: "cosmetics",
  power_up: "power-ups",
};

/** What one perk does, as a short line (a node card lists these). */
export function describePerk(perk: SkillPerk): string {
  switch (perk.kind) {
    case "earn_bonus":
      return `+${plural(perk.amount, "coin")} ${EARN_LABEL[perk.source]}`;
    case "power_up_discount": {
      const names = perk.powerUps?.map((e) => POWER_UP_INFO[e].label);
      const subject = names ? listOf(names) : "power-ups";
      const verb = names?.length === 1 ? "costs" : "cost";
      return `${subject} ${verb} ${plural(perk.amount, "coin")} less`;
    }
    case "shop_discount":
      return `${listOf(perk.categories.map((c) => CATEGORY_LABEL[c]))} cost ${plural(perk.amount, "coin")} less`;
    case "egg_discount":
      return `eggs cost ${plural(perk.amount, "coin")} less`;
    case "egg_luck":
      return `luckier eggs: ${Math.round(perk.amount * 100)}% of the odds move up a tier`;
    case "gift_cap":
      return `gift ${plural(perk.amount, "more coin")} every 7 days`;
  }
}

/** A player's added-up perks as short lines, for the `/skills` summary. */
export function describePerks(perks: SkillPerks): string[] {
  const lines: string[] = [];
  const add = (perk: SkillPerk, suffix = "") =>
    lines.push(`${describePerk(perk)}${suffix}`);

  for (const [source, amount] of Object.entries(perks.earn)) {
    if (amount) {
      add({ kind: "earn_bonus", source: source as SkillEarnSource, amount });
    }
  }
  if (perks.powerUpDiscount > 0) {
    add({ kind: "power_up_discount", amount: perks.powerUpDiscount });
  }
  // A particular power-up's discount stacks on the all-power-ups one.
  const onTop = perks.powerUpDiscount > 0 ? " on top" : "";
  for (const [effect, amount] of Object.entries(perks.powerUpDiscounts)) {
    if (amount) {
      add(
        {
          kind: "power_up_discount",
          amount,
          powerUps: [effect as PowerUpKind],
        },
        onTop,
      );
    }
  }
  // Categories with the same discount read as one line.
  const byAmount = new Map<number, ShopCategory[]>();
  for (const [category, amount] of Object.entries(perks.shopDiscounts)) {
    if (amount) {
      byAmount.set(amount, [
        ...(byAmount.get(amount) ?? []),
        category as ShopCategory,
      ]);
    }
  }
  for (const [amount, categories] of byAmount) {
    add({ kind: "shop_discount", amount, categories });
  }
  if (perks.eggDiscount > 0) {
    add({ kind: "egg_discount", amount: perks.eggDiscount });
  }
  if (perks.eggLuck > 0) add({ kind: "egg_luck", amount: perks.eggLuck });
  if (perks.giftCap > 0) add({ kind: "gift_cap", amount: perks.giftCap });
  return lines;
}
