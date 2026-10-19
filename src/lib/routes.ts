// Route matching for the middleware's guards. Kept free of Astro runtime
// imports so the rules can be unit tested.
//
// One sign-in page, `/login`, for players and admins alike. Guards send
// people there with a `next` destination; the login page explains when the
// signed-in account can't open it (e.g. a player heading for `/admin`).
// `/admin/login` is the old admin sign-in URL, now a redirect to `/login`.

export const LEGACY_ADMIN_LOGIN_PATH = "/admin/login";
export const LOGIN_PATH = "/login";
export const PASSWORD_PATH = "/account/password";

const normalise = (path: string) => path.replace(/\/{2,}/g, "/");

export const isAdminPath = (path: string) =>
  /^\/admin(?:\/|$)/i.test(normalise(path));

export const isAccountPath = (path: string) =>
  /^\/account(?:\/|$)/i.test(normalise(path));

export const isAuthPagePath = (path: string) =>
  /^\/(?:login|logout)\/?$/i.test(normalise(path));

/**
 * Tests both the route Astro matched and the raw URL, so variants like
 * `//admin/players` can't slip past a guard.
 */
export const matchesRoute = (
  context: { routePattern: string; url: URL },
  test: (path: string) => boolean,
) => test(context.routePattern) || test(context.url.pathname);

/** The sign-in page path, carrying the current URL as `next`. */
export function loginRedirectPath(loginPath: string, url: URL): string {
  const target = new URL(loginPath, url);
  target.searchParams.set("next", url.pathname + url.search);
  return target.pathname + target.search;
}
