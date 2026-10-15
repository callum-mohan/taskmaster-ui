import { defineMiddleware } from "astro:middleware";
import { loadCompetition } from "./data/competition";
import { createQueries, type Queries } from "./data/queries";
import { getSessionPlayer } from "./data/accounts";
import { getSessionUser, hasSessionCookie } from "./lib/auth";
import type { AdminUser, SessionPlayer, Viewer } from "./types";

// Two sign-in portals: `/admin/login` for admins and `/login` for players.
// Each guard sends people to its own portal, which explains (and links to
// the other portal) when someone arrives with the wrong kind of account.
const ADMIN_LOGIN_PATH = "/admin/login";
const LOGIN_PATH = "/login";
const PASSWORD_PATH = "/account/password";

const normalise = (path: string) => path.replace(/\/{2,}/g, "/");
const isAdminPath = (path: string) => /^\/admin(?:\/|$)/i.test(normalise(path));
const isAccountPath = (path: string) =>
  /^\/account(?:\/|$)/i.test(normalise(path));
const isAuthPagePath = (path: string) =>
  /^\/(?:login|logout)\/?$/i.test(normalise(path));

export const onRequest = defineMiddleware(async (context, next) => {
  // Send `www.` visitors to the apex domain, keeping the path and query.
  if (context.url.hostname.startsWith("www.")) {
    const target = new URL(context.url);
    target.hostname = target.hostname.slice(4);
    return context.redirect(target.href, 301);
  }

  // Load the competition data lazily and at most once per request, so routes
  // that never ask for it (e.g. the sitemap index) skip the query.
  let queries: Promise<Queries> | undefined;
  context.locals.getQueries = () =>
    (queries ??= loadCompetition().then(createQueries));

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
    };
  };

  // Guard on the route Astro actually matched, not just the raw URL, so
  // variants like `//admin/players` can't slip past the check.
  const { pathname } = context.url;
  const route = context.routePattern;
  const matches = (test: (path: string) => boolean) =>
    test(route) || test(pathname);
  const loginRedirect = (loginPath: string) => {
    const target = new URL(loginPath, context.url);
    target.searchParams.set("next", pathname + context.url.search);
    return context.redirect(target.pathname + target.search);
  };

  if (matches(isAdminPath)) {
    if (route !== ADMIN_LOGIN_PATH) {
      const admin = await sessionUser();
      if (!admin) return loginRedirect(ADMIN_LOGIN_PATH);
      // The admin portal tells non-admins where to go instead.
      if (!admin.isAdmin) return context.redirect(ADMIN_LOGIN_PATH);
      context.locals.admin = admin;
    }
  } else if (matches(isAccountPath)) {
    if (!(await sessionUser())) return loginRedirect(LOGIN_PATH);
    const linked = await sessionPlayer();
    // The player portal explains accounts without a player profile.
    if (!linked) return context.redirect(LOGIN_PATH);
    // A temporary password must be replaced before anything else.
    if (linked.mustChangePassword && route !== PASSWORD_PATH) {
      return context.redirect(PASSWORD_PATH);
    }
    context.locals.player = linked;
  } else if (!matches(isAuthPagePath)) {
    const response = await next();
    // Public pages show the signed-in user in the navbar, so a signed-in
    // copy must never be stored and replayed (e.g. after logging out).
    if (hasSessionCookie(context.request)) {
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
