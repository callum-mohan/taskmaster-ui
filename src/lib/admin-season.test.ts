import { describe, expect, it } from "vitest";
import {
  adminSeasonOf,
  defaultWeekId,
  selectedSeason,
  withSeason,
} from "./admin-season";
import { createSeasonDirectory } from "../data/seasons";
import { season } from "../test/fixtures";

const first = season({ id: "cohort-2026", isCurrent: false, status: "closed" });
const now = season({ id: "cohort-2027", name: "Cohort 2027" });
const seasons = createSeasonDirectory([first, now], {
  players: [{ id: "rose", seasonId: "cohort-2026" }],
  teams: [{ id: "reds", seasonId: "cohort-2026" }],
  tasks: [{ id: "week-01", seasonId: "cohort-2026" }],
});
const url = (path: string) => new URL(path, "https://example.com");

describe("adminSeasonOf", () => {
  it("uses the record's season on record screens", () => {
    for (const route of [
      "/admin/weeks/[id]",
      "/admin/weeks/[id]/judge",
      "/admin/weeks/[id]/recap",
    ]) {
      expect(
        adminSeasonOf(route, { id: "week-01" }, url("/x"), seasons)?.id,
      ).toBe("cohort-2026");
    }
    expect(
      adminSeasonOf("/admin/players/[id]", { id: "rose" }, url("/x"), seasons)
        ?.id,
    ).toBe("cohort-2026");
    expect(
      adminSeasonOf("/admin/teams/[id]", { id: "reds" }, url("/x"), seasons)
        ?.id,
    ).toBe("cohort-2026");
  });

  it("has no season for unknown records", () => {
    expect(
      adminSeasonOf("/admin/weeks/[id]", { id: "nope" }, url("/x"), seasons),
    ).toBeUndefined();
  });

  it("takes whole-season screens' season from ?season=, else the current", () => {
    expect(
      adminSeasonOf("/admin/roster", {}, url("/admin/roster"), seasons)?.id,
    ).toBe("cohort-2027");
    expect(
      adminSeasonOf(
        "/admin/weeks/new",
        {},
        url("/admin/weeks/new?season=cohort-2026"),
        seasons,
      )?.id,
    ).toBe("cohort-2026");
    expect(
      adminSeasonOf(
        "/admin/activity",
        {},
        url("/admin/activity?season=cohort-2026&kind=score"),
        seasons,
      )?.id,
    ).toBe("cohort-2026");
  });

  it("ignores screens that aren't about a season", () => {
    for (const route of [
      "/admin/polls/[id]",
      "/admin/seasons/[id]",
      "/admin",
    ]) {
      expect(
        adminSeasonOf(route, { id: "week-01" }, url("/x"), seasons),
      ).toBeUndefined();
    }
  });
});

describe("selectedSeason", () => {
  it("falls back to the current season for an unknown id", () => {
    expect(selectedSeason(url("/?season=nope"), seasons)?.id).toBe(
      "cohort-2027",
    );
  });
});

describe("withSeason", () => {
  it("leaves the current season implicit", () => {
    expect(withSeason("/admin/roster", now)).toBe("/admin/roster");
    expect(withSeason("/admin/roster", undefined)).toBe("/admin/roster");
  });

  it("adds ?season= before any hash, keeping existing queries", () => {
    expect(withSeason("/admin/roster?done=saved#squads", first)).toBe(
      "/admin/roster?done=saved&season=cohort-2026#squads",
    );
  });
});

describe("defaultWeekId", () => {
  it("prefixes weeks after the first season with the season id", () => {
    expect(defaultWeekId(first, 3, [first, now])).toBe("week-03");
    expect(defaultWeekId(now, 3, [first, now])).toBe("cohort-2027-week-03");
  });
});
