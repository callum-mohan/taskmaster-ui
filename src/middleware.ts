import { defineMiddleware, sequence } from "astro:middleware";
<<<<<<< Updated upstream
import { loadCompetition, type CompetitionViewer } from "./data/competition";
=======
import {
  buildCompetition,
  buildSeasonDirectory,
  invalidateCompetitionCache,
  loadCompetitionRows,
  type CompetitionRows,
  type CompetitionViewer,
} from "./data/competition";
>>>>>>> Stashed changes
import { createQueries, type Queries } from "./data/queries";
import { buildHallOfFame } from "./data/hall-of-fame-queries";
import { getSessionPlayer } from "./data/accounts";
import { getSessionUser, hasSessionCookie } from "./lib/auth";
import { readRevealCookies } from "./lib/task-reveal";
import {
  isAccountPath,
  isAdminPath,
  isAuthPagePath,
  LEGACY_ADMIN_LOGIN_PATH,
  LOGIN_PATH,
  loginRedirectPath,
  matchesRoute,
  PASSWORD_PATH,
} from "./lib/routes";
import { withSecurityHeaders } from "./lib/security-headers";
import { legacyAdminPath } from "./lib/admin-nav";
import { adminSeasonOf, CLOSED_PARAM } from "./lib/admin-season";
import { withBase, withoutBase } from "./lib/url";
import type {
  AdminUser,
  HallOfFame,
  Season,
  SeasonDirectory,
  SessionPlayer,
  Viewer,
} from "./types";

// Stands in for the current season on a database with no seasons yet, so
// pages render their empty states instead of failing.
const NO_SEASON: Season = {
  id: "",
  name: "No season yet",
  isCurrent: true,
  createdAt: new Date(0).toISOString(),
  status: "upcoming",
  weekCount: 0,
};

const securityHeaders = defineMiddleware(async (context, next) =>
  withSecurityHeaders(await next(), context.url),
);

const app = defineMiddleware(async (context, next) => {
  // Send `www.` visitors to the apex domain, keeping the path and query.
  if (context.url.hostname.startsWith("www.")) {
    const target = new URL(context.url);
    target.hostname = target.hostname.slice(4);
    return context.redirect(target.href, 301);
  }

  // Load the competition data lazily and at most once per request, so routes
  // that never ask for it (e.g. the sitemap index) skip the query. Guarded
<<<<<<< Updated upstream
  // admin routes (only reached by admins, see below) see real task content;
  // everywhere else password-protected tasks are redacted unless the
  // visitor unlocked them.
  let queries: Promise<Queries> | undefined;
=======
  // admin routes (only reached by admins, see below) see real task content
  // read straight from the database; everywhere else password-protected
  // tasks are redacted unless the visitor unlocked them, and the raw rows
  // come from the per-data-centre cache (see `data/competition.ts`).
  let rows: Promise<CompetitionRows> | undefined;
  let directory: Promise<SeasonDirectory> | undefined;
  let hallOfFame: Promise<HallOfFame> | undefined;
  const queriesBySeason = new Map<string, Promise<Queries>>();
>>>>>>> Stashed changes
  const isGuardedAdmin =
    matchesRoute(context, isAdminPath) &&
    context.routePattern !== LEGACY_ADMIN_LOGIN_PATH;
  const viewer: CompetitionViewer = isGuardedAdmin
    ? { mode: "admin" }
    : { mode: "public", revealTokens: readRevealCookies(context.request) };
<<<<<<< Updated upstream
  context.locals.getQueries = () =>
    (queries ??= loadCompetition(viewer).then(createQueries));
=======
  const loadRows = () =>
    (rows ??= loadCompetitionRows(viewer, context.url.origin));
  const getSeasons = () =>
    (directory ??= loadRows().then(buildSeasonDirectory));
  // Each season's snapshot is built at most once per request, from the
  // same rows. No season (or an unknown id) means the current season.
  const getQueries = async (seasonId?: string): Promise<Queries> => {
    const seasons = await getSeasons();
    const season =
      (seasonId === undefined ? undefined : seasons.getSeason(seasonId)) ??
      seasons.current ??
      seasons.seasons.at(-1) ??
      NO_SEASON;
    let queries = queriesBySeason.get(season.id);
    if (!queries) {
      queries = loadRows()
        .then((all) => buildCompetition(all, viewer, season))
        .then(createQueries);
      queriesBySeason.set(season.id, queries);
    }
    return queries;
  };
  context.locals.getQueries = getQueries;
  context.locals.getSeasons = getSeasons;
  context.locals.getHallOfFame = () =>
    (hallOfFame ??= getSeasons().then(async ({ seasons }) =>
      buildHallOfFame(
        await Promise.all(
          seasons
            .filter((season) => season.status === "closed")
            .map((season) => getQueries(season.id)),
        ),
      ),
    ));
>>>>>>> Stashed changes

  // The signed-in user and their player link, each looked up at most once
  // per request and only when something asks (guards, the navbar).
  let user: Promise<AdminUser | undefined> | undefined;
  let player: Promise<SessionPlayer | undefined> | undefined;
  const sessionUser = () => (user ??= getSessionUser(context));
  const sessionPlayer = () =>
    (player ??= sessionUser().then((u) => u && getSessionPlayer(u)));
  context.locals.getViewer = async (): Promise<Viewer | undefined> => {
    const signedIn = await sessionUser();
    if (!signedIn) return undefined;
    const linked = await sessionPlayer();
    return {
      name: linked?.playerName ?? signedIn.name,
      isAdmin: signedIn.isAdmin,
      ...(linked && { playerId: linked.playerId }),
      ...(linked?.notificationsReadAt && {
        notificationsReadAt: linked.notificationsReadAt,
      }),
    };
  };

  // Guard on the route Astro actually matched, not just the raw URL, so
  // variants like `//admin/players` can't slip past the check.
  const route = context.routePattern;
  const matches = (test: (path: string) => boolean) =>
    matchesRoute(context, test);
  const loginRedirect = (loginPath: string) =>
    context.redirect(loginRedirectPath(loginPath, context.url));

  if (matches(isAdminPath)) {
    if (route !== LEGACY_ADMIN_LOGIN_PATH) {
      const admin = await sessionUser();
      // Signed-out visitors sign in; signed-in non-admins are told why not.
      if (!admin?.isAdmin) return loginRedirect(LOGIN_PATH);
      context.locals.admin = admin;
      // Screens from before the admin was regrouped live under new URLs.
      const moved = legacyAdminPath(withoutBase(context.url.pathname));
      if (moved) {
        const [path, hash] = moved.split("#");
        const target = `${withBase(path)}${context.url.search}${hash ? `#${hash}` : ""}`;
        // 308 keeps a form post from an old tab a post.
        const method = context.request.method;
        return context.redirect(
          target,
          method === "GET" || method === "HEAD" ? 301 : 308,
        );
      }
      // A closed season is read-only until it's reopened: refuse any write
      // to its weeks, roster or scores, and say why on the page.
      if (!isSafeMethod(context.request.method)) {
        const season = adminSeasonOf(
          route,
          context.params,
          context.url,
          await getSeasons(),
        );
        if (season?.status === "closed") {
          const back = new URL(context.url);
          back.searchParams.set(CLOSED_PARAM, "1");
          return context.redirect(`${back.pathname}${back.search}`, 303);
        }
      }
    }
  } else if (matches(isAccountPath)) {
    if (!(await sessionUser())) return loginRedirect(LOGIN_PATH);
    const linked = await sessionPlayer();
    // The login page explains accounts without a player profile.
    if (!linked) return loginRedirect(LOGIN_PATH);
    // A temporary password must be replaced before anything else.
    if (linked.mustChangePassword && route !== PASSWORD_PATH) {
      return context.redirect(PASSWORD_PATH);
    }
    context.locals.player = linked;
  } else if (!matches(isAuthPagePath)) {
    const response = await next();
    // Public pages show the signed-in user in the navbar, so a signed-in
    // copy must never be stored and replayed (e.g. after logging out). The
    // same goes for pages rendered with a visitor's task-reveal cookies.
    if (
      hasSessionCookie(context.request) ||
      (viewer.mode === "public" && viewer.revealTokens.size > 0)
    ) {
      response.headers.set("Cache-Control", "private, no-store");
    }
    return response;
  }

  const response = await next();
  // Sign-in and account pages are per-user and must never be cached or indexed.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
});

export const onRequest = sequence(securityHeaders, app);
