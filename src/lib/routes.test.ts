import { describe, expect, it } from "vitest";
import {
  isAccountPath,
  isAdminPath,
  isAuthPagePath,
  isCompetitionNeutralRoute,
  isSafeMethod,
  LOGIN_PATH,
  loginRedirectPath,
  matchesRoute,
} from "./routes";

describe("isAdminPath", () => {
  it.each(["/admin", "/admin/", "/admin/players", "/admin/scores/week-01"])(
    "guards %s",
    (path) => expect(isAdminPath(path)).toBe(true),
  );

  it.each(["//admin", "//admin//players", "/ADMIN/players", "/Admin"])(
    "guards the variant %s",
    (path) => expect(isAdminPath(path)).toBe(true),
  );

  it.each(["/", "/administrator", "/admins", "/players/admin", "/x/admin/"])(
    "leaves %s alone",
    (path) => expect(isAdminPath(path)).toBe(false),
  );
});

describe("isAccountPath", () => {
  it.each(["/account", "/account/", "/account/password", "//account/x"])(
    "guards %s",
    (path) => expect(isAccountPath(path)).toBe(true),
  );

  it.each(["/accounts", "/players/account", "/"])("leaves %s alone", (path) =>
    expect(isAccountPath(path)).toBe(false),
  );
});

describe("isAuthPagePath", () => {
  it.each(["/login", "/login/", "/logout", "//LOGIN"])("matches %s", (path) =>
    expect(isAuthPagePath(path)).toBe(true),
  );

  it.each(["/login/extra", "/logins", "/admin/login"])(
    "doesn't match %s",
    (path) => expect(isAuthPagePath(path)).toBe(false),
  );
});

describe("isCompetitionNeutralRoute", () => {
  it.each([
    "/account/notifications",
    "/account/notifications/read",
    "/account/password",
  ])("exempts %s from the cache purge", (route) =>
    expect(isCompetitionNeutralRoute(route)).toBe(true),
  );

  it.each([
    "/account",
    "/account/polls/[id]",
    "/account/predictions/[taskId]",
    "/account/gallery/[taskId]",
    "/account/submissions/[taskId]",
    "/admin/players/[id]",
    "/account/password/extra",
  ])("purges after %s", (route) =>
    expect(isCompetitionNeutralRoute(route)).toBe(false),
  );
});

describe("isSafeMethod", () => {
  it.each(["GET", "HEAD", "OPTIONS", "get"])("%s is safe", (method) =>
    expect(isSafeMethod(method)).toBe(true),
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s changes data", (method) =>
    expect(isSafeMethod(method)).toBe(false),
  );
});

describe("matchesRoute", () => {
  const context = (routePattern: string, path: string) => ({
    routePattern,
    url: new URL(`https://example.test${path}`),
  });

  it("matches on the route Astro resolved", () => {
    expect(matchesRoute(context("/admin/players", "/x"), isAdminPath)).toBe(
      true,
    );
  });

  it("matches on the raw URL when the route pattern differs", () => {
    expect(matchesRoute(context("/404", "//admin/players"), isAdminPath)).toBe(
      true,
    );
  });

  it("matches neither for public pages", () => {
    expect(matchesRoute(context("/tasks/[id]", "/tasks/1"), isAdminPath)).toBe(
      false,
    );
  });
});

describe("loginRedirectPath", () => {
  it("carries the current path and query as `next`", () => {
    const url = new URL("https://example.test/admin/scores?task=week-02");
    expect(loginRedirectPath(LOGIN_PATH, url)).toBe(
      "/login?next=%2Fadmin%2Fscores%3Ftask%3Dweek-02",
    );
  });

  it("stays on the same origin", () => {
    const url = new URL("https://example.test/account");
    expect(loginRedirectPath(LOGIN_PATH, url)).toMatch(/^\/login\?/);
  });
});
