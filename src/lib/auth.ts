import type { APIContext } from "astro";
import {
  createAuthServer,
  extractNeonAuthCookies,
  type NeonAuthServer,
} from "@neondatabase/auth/server";
import { NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET } from "astro:env/server";
import type { AdminUser } from "../types";

/**
 * A minimal Astro adapter for Managed Better Auth (Neon Auth), built on the
 * framework-agnostic `@neondatabase/auth/server` toolkit. Sign-in/out run as
 * server-side calls from the admin form handlers, so session cookies are set
 * first-party on our own domain and no auth code ships to the browser.
 */
type RequestScope = Pick<APIContext, "request" | "cookies" | "url">;

export function createAuth(context: RequestScope): NeonAuthServer {
  return createAuthServer({
    baseUrl: NEON_AUTH_BASE_URL,
    cookieSecret: NEON_AUTH_COOKIE_SECRET,
    // Re-validate the cached session against Neon Auth every minute so a
    // revoked admin role or session takes effect quickly.
    sessionDataTtl: 60,
    context: () => ({
      getCookies: () => extractNeonAuthCookies(context.request.headers),
      setCookie: (name, value, options) =>
        context.cookies.set(name, value, options),
      getHeader: (name) => context.request.headers.get(name),
      getOrigin: () =>
        context.request.headers.get("origin") ?? context.url.origin,
      getFramework: () => "astro",
    }),
  });
}

/** Better Auth stores roles as a comma-separated string (e.g. "user,admin"). */
export function hasAdminRole(role: string | null | undefined): boolean {
  return (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .includes("admin");
}

/** The signed-in user for this request, or `undefined` when signed out. */
export async function getSessionUser(
  context: RequestScope,
): Promise<AdminUser | undefined> {
  const { data } = await createAuth(context).getSession();
  const user = data?.user;
  if (!user) return undefined;
  const role = (user as { role?: string | null }).role;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: hasAdminRole(role),
  };
}
