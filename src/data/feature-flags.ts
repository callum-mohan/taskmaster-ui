import type { FeatureFlagKey, FeatureFlags, FeatureFlagView } from "../types";
import type { featureFlags as featureFlagsTable } from "../db/schema";
import { timestamptzToIso } from "../lib/time";

// Site-wide feature flags. Every flag is off until an admin turns it on in
// `/admin/site#flags` (a flag with no `feature_flags` row is off), so a new
// feature can ship dark and be switched on without a deploy.

export const FEATURE_FLAGS: Record<
  FeatureFlagKey,
  { label: string; description: string }
> = {
  shop_eggs: {
    label: "Mystery eggs",
    description:
      "Shows the egg crates in the shop and lets players crack them. Off: the eggs, recent hatches and egg-exclusive items are hidden, and nobody can open one.",
  },
  storm_mode: {
    label: "Storm mode",
    description:
      "Puts the public site in the middle of a hurricane: driving rain, lightning, gusts, flying debris and “A Storm Is Brewing” blown across the screen. Everything stays clickable, admin pages stay calm, and visitors who ask for reduced motion get a still version. Off: the weather clears.",
  },
  skill_trees: {
    label: "Skill trees",
    description:
      "Opens /skills: players commit to one pathway a season (Stormbrewer, Elite Hacker, Friendkeeper, Overachiever or Elephant Cartographer) and unlock its nodes with Clim Coin for coin perks, titles and name colours. Off: the page, its links and pathway sigils are hidden and nobody can unlock; perks and rewards already unlocked keep working.",
  },
  mini_tasks: {
    label: "Mini-tasks",
    description:
      "Shows this season's daily and bonus mini-tasks on the homepage and in players' accounts, with what each is worth (1–5 Clim Coin) and whether they've done it. Off: the panels are hidden. Admins can still set mini-tasks and tick off completions in /admin/site, and coins already earned stay in wallets.",
  },
  achievements: {
    label: "Achievements",
    description:
      "Opens /account/achievements: every achievement a player can earn this season, locked or unlocked, with a progress bar towards each. Off: the page and its links are hidden.",
  },
  marketplace: {
    label: "Marketplace",
    description:
      "Opens /market: players list pets, avatars, cosmetics, egg exclusives and unused power-ups (not Shield, Mirror or Insurance) for Clim Coin, buy each other's listings and make offers. Listings expire after 7 days. Off: the market, its links and the wallet's sell buttons are hidden and nobody can list, buy or offer; open listings and offers stay put (offered coins stay held) until they expire or it's back on.",
  },
  pool_bracket: {
    label: "Pool bracket",
    description:
      "Shows the weekly pool bracket at /pool. Off: the public pages 404; admins can still set up teams and draws.",
  },
};

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

type FeatureFlagRow = typeof featureFlagsTable.$inferSelect;

const isKey = (key: string): key is FeatureFlagKey =>
  FEATURE_FLAG_KEYS.some((k) => k === key);

/** Every known flag's state; unknown keys are ignored, missing ones are off. */
export function mapFeatureFlags(rows: readonly FeatureFlagRow[]): FeatureFlags {
  const enabled = new Set(
    rows.filter((row) => row.enabled && isKey(row.key)).map((row) => row.key),
  );
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, enabled.has(key)]),
  ) as FeatureFlags;
}

/** Every known flag with its state and last change, for the admin screen. */
export function featureFlagViews(
  rows: readonly FeatureFlagRow[],
): FeatureFlagView[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return FEATURE_FLAG_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      ...FEATURE_FLAGS[key],
      enabled: row?.enabled ?? false,
      ...(row && {
        changedBy: row.actorName,
        changedAt: timestamptzToIso(row.updatedAt),
      }),
    };
  });
}
