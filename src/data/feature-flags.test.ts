import { describe, expect, it } from "vitest";
import { featureFlagViews, mapFeatureFlags } from "./feature-flags";

const row = (key: string, enabled: boolean) => ({
  key,
  enabled,
  actorId: "u1",
  actorName: "Taskmaster",
  updatedAt: "2026-10-22 00:30:00+00",
});

describe("mapFeatureFlags", () => {
  it("is off without a row, so new features ship disabled", () => {
    expect(mapFeatureFlags([])).toEqual({
      shop_eggs: false,
      storm_mode: false,
      skill_trees: false,
    });
  });

  it("reads each known flag and ignores unknown ones", () => {
    expect(
      mapFeatureFlags([row("shop_eggs", true), row("nope", true)]),
    ).toEqual({ shop_eggs: true, storm_mode: false, skill_trees: false });
    expect(
      mapFeatureFlags([row("shop_eggs", false), row("storm_mode", true)]),
    ).toEqual({ shop_eggs: false, storm_mode: true, skill_trees: false });
  });
});

describe("featureFlagViews", () => {
  it("lists every flag with who last changed it", () => {
    expect(featureFlagViews([])).toEqual([
      expect.objectContaining({ key: "shop_eggs", enabled: false }),
      expect.objectContaining({ key: "storm_mode", enabled: false }),
      expect.objectContaining({ key: "skill_trees", enabled: false }),
    ]);
    expect(featureFlagViews([])[0].changedBy).toBeUndefined();
    expect(featureFlagViews([row("shop_eggs", true)])[0]).toMatchObject({
      enabled: true,
      label: "Mystery eggs",
      changedBy: "Taskmaster",
      changedAt: "2026-10-22T00:30:00.000Z",
    });
  });
});
