import { describe, expect, it } from "vitest";
import {
  ADMIN_HOME,
  ADMIN_SECTIONS,
  isAdminSectionActive,
  legacyAdminPath,
  weekHref,
} from "./admin-nav";

describe("isAdminSectionActive", () => {
  it("matches the dashboard only on /admin itself", () => {
    expect(isAdminSectionActive("/admin", ADMIN_HOME)).toBe(true);
    expect(isAdminSectionActive("/admin/", ADMIN_HOME)).toBe(true);
    expect(isAdminSectionActive("/admin/weeks", ADMIN_HOME)).toBe(false);
  });

  it("matches a section and its sub-pages", () => {
    expect(isAdminSectionActive("/admin/weeks", "/admin/weeks")).toBe(true);
    expect(
      isAdminSectionActive("/admin/weeks/week-01/judge", "/admin/weeks"),
    ).toBe(true);
    expect(isAdminSectionActive("/admin/weeksend", "/admin/weeks")).toBe(false);
  });

  it("matches extra path prefixes a section claims", () => {
    const roster = ADMIN_SECTIONS.find((s) => s.label === "roster")!;
    expect(
      isAdminSectionActive("/admin/teams/red", roster.href, roster.match),
    ).toBe(true);
    expect(
      isAdminSectionActive("/admin/players/new", roster.href, roster.match),
    ).toBe(true);
    expect(
      isAdminSectionActive("/admin/polls", roster.href, roster.match),
    ).toBe(false);
  });
});

describe("weekHref", () => {
  it("builds each tab's path", () => {
    expect(weekHref("week-03")).toBe("/admin/weeks/week-03");
    expect(weekHref("week-03", "judge")).toBe("/admin/weeks/week-03/judge");
    expect(weekHref("week-03", "live")).toBe("/admin/weeks/week-03/live");
    expect(weekHref("week-03", "recap")).toBe("/admin/weeks/week-03/recap");
  });
});

describe("legacyAdminPath", () => {
  it.each([
    ["/admin/tasks", "/admin/weeks"],
    ["/admin/tasks/", "/admin/weeks"],
    ["/admin/tasks/new", "/admin/weeks/new"],
    ["/admin/tasks/week-02", "/admin/weeks/week-02"],
    ["/admin/scores", "/admin/weeks"],
    ["/admin/scores/week-02", "/admin/weeks/week-02/judge"],
    ["/admin/submissions", "/admin/weeks"],
    ["/admin/submissions/week-02", "/admin/weeks/week-02/judge"],
    ["/admin/live", "/admin/weeks"],
    ["/admin/live/week-02", "/admin/weeks/week-02/live"],
    ["/admin/recaps", "/admin/weeks"],
    ["/admin/recaps/week-02/", "/admin/weeks/week-02/recap"],
    ["//admin/scores/week-02", "/admin/weeks/week-02/judge"],
    ["/admin/players", "/admin/roster"],
    ["/admin/teams", "/admin/roster#squads"],
    ["/admin/polls", "/admin/site"],
    ["/admin/changelog", "/admin/site#changelog"],
  ])("sends %s to %s", (from, to) => {
    expect(legacyAdminPath(from)).toBe(to);
  });

  it.each([
    "/admin",
    "/admin/weeks",
    "/admin/weeks/week-02/judge",
    "/admin/players/new",
    "/admin/players/rose",
    "/admin/teams/red",
    "/admin/polls/new",
    "/admin/changelog/3",
    "/admin/scores/week-02/extra",
    "/tasks/week-02",
  ])("leaves %s alone", (path) => {
    expect(legacyAdminPath(path)).toBeUndefined();
  });

  it("ignores a malformed escape rather than throwing", () => {
    expect(legacyAdminPath("/admin/scores/%E0%A4%A")).toBeUndefined();
  });
});
