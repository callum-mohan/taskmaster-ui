import { defineMiddleware } from "astro:middleware";
import { loadCompetition, type CompetitionViewer } from "./data/competition";
import { createQueries, type Queries } from "./data/queries";
import { getSessionPlayer } from "./data/accounts";
import { getSessionUser, hasSessionCookie } from "./lib/auth";
import { readRevealCookies } from "./lib/task-reveal";
import type { AdminUser, SessionPlayer, Viewer } from "./types";

// One sign-in page, `/login`, for players and admins alike. Guards send
// people there with a `next` destination; the login page explains when the
// signed-in account can't open it (e.g. a player heading for `/admin`).
// `/admin/login` is the old admin sign-in URL, now a redirect to `/login`.
const LEGACY_ADMIN_LOGIN_PATH = "/admin/login";
const LOGIN_PATH = "/login";
const PASSWORD_PATH = "/account/password";

const normalise = (path: string) => path.replace(/\/{2,}/g, "/");
const isAdminPath = (path: string) => /^\/admin(?:\/|$)/i.test(normalise(path));
const isAccountPath = (path: string) =>
  /^\/account(?:\/|$)/i.test(normalise(path));
const isAuthPagePath = (path: string) =>
  /^\/(?:login|logout)\/?$/i.test(normalise(path));

const matchesRoute = (
  context: { routePattern: string; url: URL },
  test: (path: string) => boolean,
) => test(context.routePattern) || test(context.url.pathname);

export const onRequest = defineMiddleware(async (context, next) => {
  // Send `www.` visitors to the apex domain, keeping the path and query.
  if (context.url.hostname.startsWith("www.")) {
    const target = new URL(context.url);
    target.hostname = target.hostname.slice(4);
    return context.redirect(target.href, 301);
  }

  // Load the competition data lazily and at most once per request, so routes
  // that never ask for it (e.g. the sitemap index) skip the query. Guarded
  // admin routes (only reached by admins, see below) see real task content;
  // everywhere else password-protected tasks are redacted unless the
  // visitor unlocked them.
  let queries: Promise<Queries> | undefined;
  const isGuardedAdmin =
    matchesRoute(context, isAdminPath) &&
    context.routePattern !== LEGACY_ADMIN_LOGIN_PATH;
  const viewer: CompetitionViewer = isGuardedAdmin
    ? { mode: "admin" }
    : { mode: "public", revealTokens: readRevealCookies(context.request) };
  context.locals.getQueries = () =>
    (queries ??= loadCompetition(viewer).then(createQueries));

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
  const { pathname } = context.url;
  const route = context.routePattern;
  const matches = (test: (path: string) => boolean) =>
    matchesRoute(context, test);
  const loginRedirect = (loginPath: string) => {
    const target = new URL(loginPath, context.url);
    target.searchParams.set("next", pathname + context.url.search);
    return context.redirect(target.pathname + target.search);
  };

  if (matches(isAdminPath)) {
    if (route !== LEGACY_ADMIN_LOGIN_PATH) {
      const admin = await sessionUser();
      // Signed-out visitors sign in; signed-in non-admins are told why not.
      if (!admin?.isAdmin) return loginRedirect(LOGIN_PATH);
      context.locals.admin = admin;
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
