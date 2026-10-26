import { z } from "astro/zod";
import {
  avatarUrlField,
  bioField,
  formValues,
  parseWith,
  type ParseResult,
} from "./admin-forms";
import type { MarketOutcome, PollSettings } from "../types";
import {
  ACTIVE_POWER_UP_KINDS,
  GIFT_MESSAGE_MAX,
  GIFT_WEEKLY_CAP,
  LOADOUT_SLOTS,
  MARKET_LISTING_DAYS,
  WISH_MAX,
} from "../data/coin-rules";

// Validation for the player self-service forms under `/account`. Players can
// only touch their bio and avatar; everything else stays admin-only.

const profileSchema = z.object({
  bio: bioField,
  avatarUrl: avatarUrlField,
});

export type ProfileInput = z.output<typeof profileSchema>;

export function parseProfileForm(form: FormData): ParseResult<ProfileInput> {
  const values = formValues(form);
  return parseWith(
    profileSchema,
    { bio: values.bio ?? "", avatarUrl: values.avatarUrl ?? "" },
    values,
  );
}

export const MIN_PASSWORD_LENGTH = 12;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required."),
    newPassword: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      )
      .max(128, "Keep it under 128 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a different password from your current one.",
  });

export type PasswordInput = z.output<typeof passwordSchema>;

export function parsePasswordForm(form: FormData): ParseResult<PasswordInput> {
  const values = formValues(form);
  return parseWith(
    passwordSchema,
    {
      currentPassword: values.currentPassword ?? "",
      newPassword: values.newPassword ?? "",
      confirmPassword: values.confirmPassword ?? "",
    },
    // Never echo passwords back into a re-rendered form.
    {},
  );
}

// ── Poll ballots ──────────────────────────────────────────────────────

/** Outcome codes the vote endpoint sends back to the homepage. */
export type VoteOutcome =
  | "voted"
  | "changed"
  | "retracted"
  | "not-open"
  | "locked"
  | "too-few"
  | "too-many"
  | "invalid";

export const VOTE_OUTCOMES: readonly VoteOutcome[] = [
  "voted",
  "changed",
  "retracted",
  "not-open",
  "locked",
  "too-few",
  "too-many",
  "invalid",
];

/**
 * Checks a submitted ballot against the poll's rules. Choices that aren't
 * this poll's options are rejected rather than ignored.
 */
export function parseBallot(
  form: FormData,
  poll: Pick<PollSettings, "options" | "minChoices" | "maxChoices">,
): { ok: true; optionIds: number[] } | { ok: false; outcome: VoteOutcome } {
  const ids = [
    ...new Set(
      form
        .getAll("choice")
        .filter((v): v is string => typeof v === "string")
        .map(Number),
    ),
  ];
  const valid = new Set(poll.options.map((o) => o.id));
  if (!ids.every((id) => valid.has(id)))
    return { ok: false, outcome: "invalid" };
  if (ids.length < poll.minChoices) return { ok: false, outcome: "too-few" };
  if (ids.length > poll.maxChoices) return { ok: false, outcome: "too-many" };
  return { ok: true, optionIds: ids };
}

/** "pick one", "pick 2", "pick 1–3": the ballot rule in words. */
export function describeChoiceRule(
  poll: Pick<PollSettings, "minChoices" | "maxChoices">,
): string {
  const { minChoices: min, maxChoices: max } = poll;
  if (min === 1 && max === 1) return "pick one";
  if (min === max) return `pick ${min}`;
  return `pick ${min}–${max}`;
}

/** Message and tone for a vote outcome shown on the poll card. */
export function describeVoteOutcome(
  outcome: VoteOutcome,
  poll: Pick<
    PollSettings,
    "minChoices" | "maxChoices" | "voteBonusPoints" | "bonusTaskId"
  >,
): { tone: "success" | "error"; message: string } {
  const bonus = poll.bonusTaskId ? poll.voteBonusPoints : 0;
  const pts = `${bonus} bonus point${bonus === 1 ? "" : "s"}`;
  const messages: Record<
    VoteOutcome,
    { tone: "success" | "error"; message: string }
  > = {
    voted: {
      tone: "success",
      message: bonus > 0 ? `Vote counted: +${pts}.` : "Vote counted.",
    },
    changed: { tone: "success", message: "Vote updated." },
    retracted: {
      tone: "success",
      message:
        bonus > 0
          ? `Vote withdrawn, along with your ${pts}.`
          : "Vote withdrawn.",
    },
    "not-open": { tone: "error", message: "This poll isn't open for votes." },
    locked: {
      tone: "error",
      message: "You've already voted, and votes on this poll are final.",
    },
    "too-few": {
      tone: "error",
      message: `Not enough options picked: ${describeChoiceRule(poll)}.`,
    },
    "too-many": {
      tone: "error",
      message: `Too many options picked: ${describeChoiceRule(poll)}.`,
    },
    invalid: {
      tone: "error",
      message: "That option is no longer on the poll. Try again.",
    },
  };
  return messages[outcome];
}

// ── Clim Coin wallet ──────────────────────────────────────────────────

const walletId = z.string().trim().min(1).max(120);

const walletActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("equip"), itemId: walletId }),
  z.object({ intent: z.literal("unequip"), slot: z.enum(LOADOUT_SLOTS) }),
  z.object({
    intent: z.literal("gift"),
    toPlayerId: walletId,
    amount: z
      .string()
      .trim()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(GIFT_WEEKLY_CAP)),
    // Optional, shown on both wallets.
    message: z
      .string()
      .trim()
      .max(GIFT_MESSAGE_MAX)
      .transform((v) => (v === "" ? null : v.replace(/\s+/g, " "))),
  }),
  z.object({
    intent: z.literal("wish"),
    // One line, shown to the Taskmaster on the admin dashboard.
    wish: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, " "))
      .pipe(z.string().min(1).max(WISH_MAX)),
  }),
  z.object({
    intent: z.literal("use"),
    // Shield, Mirror and Insurance are passive: they're never used.
    effect: z.enum(ACTIVE_POWER_UP_KINDS),
    taskId: walletId,
    // Sabotage only: blank for every other power-up.
    targetPlayerId: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === "" ? null : v)),
  }),
]);

export type WalletAction = z.output<typeof walletActionSchema>;

/**
 * A wallet page action (equip, unequip, use a power-up, make a wish or send
 * a gift), or `undefined` for a malformed post. Sabotage must name a target;
 * nothing else may.
 */
export function parseWalletAction(form: FormData): WalletAction | undefined {
  const values = formValues(form);
  const parsed = walletActionSchema.safeParse({
    intent: values.intent ?? "",
    itemId: values.itemId ?? "",
    slot: values.slot ?? "",
    effect: values.effect ?? "",
    taskId: values.taskId ?? "",
    targetPlayerId: values.targetPlayerId ?? "",
    toPlayerId: values.toPlayerId ?? "",
    amount: values.amount ?? "",
    message: values.message ?? "",
    wish: values.wish ?? "",
  });
  if (!parsed.success) return undefined;
  const action = parsed.data;
  if (
    action.intent === "use" &&
    (action.effect === "sabotage") !== (action.targetPlayerId !== null)
  ) {
    return undefined;
  }
  return action;
}

// ── Marketplace ───────────────────────────────────────────────────────

const rowId = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/)
  .transform(Number);
const coins = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));

const marketActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("list"), purchaseId: rowId, price: coins }),
  z.object({ intent: z.literal("cancel"), listingId: rowId }),
  z.object({ intent: z.literal("buy"), listingId: rowId, price: coins }),
  z.object({ intent: z.literal("offer"), listingId: rowId, amount: coins }),
  z.object({ intent: z.literal("withdraw"), offerId: rowId }),
  z.object({ intent: z.literal("accept"), offerId: rowId }),
  z.object({ intent: z.literal("decline"), offerId: rowId }),
]);

/**
 * A marketplace action. `buy` carries the price the buyer saw, so a price
 * that changed under them (it can't today, but a relist can) never sells.
 */
export type MarketAction = z.output<typeof marketActionSchema>;

/** A marketplace form post, or `undefined` when it's malformed. */
export function parseMarketAction(form: FormData): MarketAction | undefined {
  const values = formValues(form);
  const parsed = marketActionSchema.safeParse({
    intent: values.intent ?? "",
    purchaseId: values.purchaseId ?? "",
    listingId: values.listingId ?? "",
    offerId: values.offerId ?? "",
    price: values.price ?? "",
    amount: values.amount ?? "",
  });
  return parsed.success ? parsed.data : undefined;
}

const MARKET_OUTCOMES: Record<
  MarketOutcome,
  { tone: "success" | "error"; message: string }
> = {
  listed: {
    tone: "success",
    message: `Listed. It's on the market for ${MARKET_LISTING_DAYS} days unless it sells or you take it down.`,
  },
  cancelled: {
    tone: "success",
    message: "Listing taken down. The item's back in your inventory.",
  },
  bought: { tone: "success", message: "Bought. It's in your inventory now." },
  offered: {
    tone: "success",
    message:
      "Offer made. The coins are held until the seller answers, you withdraw it or the listing ends.",
  },
  withdrawn: {
    tone: "success",
    message: "Offer withdrawn. Your coins are free again.",
  },
  accepted: { tone: "success", message: "Offer accepted. Sold!" },
  declined: { tone: "success", message: "Offer declined." },
  invalid: {
    tone: "error",
    message: "That didn't work. The listing or offer may have changed.",
  },
  disabled: { tone: "error", message: "The marketplace is closed right now." },
  "season-closed": {
    tone: "error",
    message: "The season's over, so the market is closed.",
  },
  closed: {
    tone: "error",
    message: "That listing has already sold, expired or been taken down.",
  },
  owned: {
    tone: "error",
    message:
      "You already have that item (or a charge of that power-up), so you can't buy another.",
  },
  unaffordable: {
    tone: "error",
    message:
      "Not enough Clim Coin. Coins held by your other offers don't count.",
  },
  "out-of-range": {
    tone: "error",
    message: "That price is outside what this item can go for.",
  },
  untradeable: {
    tone: "error",
    message:
      "That item can't be traded (skill tree rewards, Shield, Mirror and Insurance stay put).",
  },
  spent: {
    tone: "error",
    message: "That power-up has already been used, so it can't be sold.",
  },
};

export const isMarketOutcome = (value: string): value is MarketOutcome =>
  Object.hasOwn(MARKET_OUTCOMES, value);

/** Message and tone for a marketplace outcome, shown after the redirect. */
export function describeMarketOutcome(outcome: MarketOutcome): {
  tone: "success" | "error";
  message: string;
} {
  return MARKET_OUTCOMES[outcome];
}
