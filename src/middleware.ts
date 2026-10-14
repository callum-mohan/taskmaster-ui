import { defineMiddleware } from "astro:middleware";
import { loadCompetition } from "./data/competition";
import { createQueries, type Queries } from "./data/queries";
import { getSessionUser } from "./lib/auth";

const LOGIN_PATH = "/admin/login";

const isAdminPath = (path: string) =>
  /^\/admin(?:\/|$)/i.test(path.replace(/\/{2,}/g, "/"));

export const onRequest = defineMiddleware(async (context, next) => {
  // Load the competition data lazily and at most once per request, so routes
  // that never ask for it (e.g. the sitemap index) skip the query.
  let queries: Promise<Queries> | undefined;
  context.locals.getQueries = () =>
    (queries ??= loadCompetition().then(createQueries));

  // Guard on the route Astro actually matched, not just the raw URL, so
  // variants like `//admin/players` can't slip past the check.
  const { pathname } = context.url;
  const route = context.routePattern;
  if (!isAdminPath(route) && !isAdminPath(pathname)) return next();

  if (route !== LOGIN_PATH) {
    const user = await getSessionUser(context);
    if (!user) {
      const target = new URL(LOGIN_PATH, context.url);
      target.searchParams.set("next", pathname + context.url.search);
      return context.redirect(target.pathname + target.search);
    }
    if (!user.isAdmin) {
      return context.redirect(`${LOGIN_PATH}?error=forbidden`);
    }
    context.locals.admin = user;
  }

  const response = await next();
  // Admin pages are per-user and must never be cached or indexed.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
});
