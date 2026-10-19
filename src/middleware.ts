import { defineMiddleware, sequence } from "astro:middleware";
import { loadCompetition, type CompetitionViewer } from "./data/competition";
import { createQueries, type Queries } from "./data/queries";
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
import { withBase, withoutBase } from "./lib/url";
import type { AdminUser, SessionPlayer, Viewer } from "./types";

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
