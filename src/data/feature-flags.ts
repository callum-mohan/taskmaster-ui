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
