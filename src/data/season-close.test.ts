import { describe, expect, it } from "vitest";
import { getSeasonCloseBlockers } from "./season-close";
import { task } from "../test/fixtures";

describe("getSeasonCloseBlockers", () => {
  const scored = { "week-01": "2026-01-12T10:00:00.000Z" };

  it("needs at least one week", () => {
    expect(getSeasonCloseBlockers([], {})).toEqual([
      "The season has no weeks yet.",
    ]);
  });

  it("is clear once every week is over, scored and published", () => {
    expect(getSeasonCloseBlockers([task()], scored)).toEqual([]);
  });

  it("lists every unfinished week in week order", () => {
    expect(
      getSeasonCloseBlockers(
        [
          task({ id: "week-03", weekNumber: 3, status: "live" }),
          task({ id: "week-02", weekNumber: 2 }),
          task({ resultsHeld: true }),
        ],
        scored,
      ),
    ).toEqual([
      "Week 1's results are still held for results night.",
      "Week 2 has no results yet.",
      "Week 3 hasn't finished yet.",
    ]);
  });
});
