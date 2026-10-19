import type { APIContext } from "astro";
import {
  createAuthServer,
  extractNeonAuthCookies,
  NEON_AUTH_NETWORK_ERROR_CODES,
  NEON_AUTH_SESSION_COOKIE_NAME,
  type NeonAuthServer,
} from "@neondatabase/auth/server";
import { NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET } from "astro:env/server";
import type { AdminUser } from "../types";

/**
 * A minimal Astro adapter for Managed Better Auth (Neon Auth), built on the
 * framework-agnostic `@neondatabase/auth/server` toolkit. Sign-in/out run as
 * server-side calls from the form handlers (admin and player), so session
 * cookies are set first-party on our own domain and no auth code ships to
 * the browser.
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

/**
 * Whether the request carries a Neon Auth session cookie at all. Without one,
 * `getSession()` would still make a network round trip to Neon Auth, so
 * anonymous visitors skip the lookup entirely.
 */
export function hasSessionCookie(request: Request): boolean {
  return extractNeonAuthCookies(request.headers).includes(
    `${NEON_AUTH_SESSION_COOKIE_NAME}=`,
  );
}

/** The signed-in user for this request, or `undefined` when signed out. */
export async function getSessionUser(
  context: RequestScope,
): Promise<AdminUser | undefined> {
  if (!hasSessionCookie(context.request)) return undefined;
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

/** Network failures get their own message so users know to retry. */
export function isAuthNetworkError(code: string | undefined): boolean {
  return NEON_AUTH_NETWORK_ERROR_CODES.includes(
    code as (typeof NEON_AUTH_NETWORK_ERROR_CODES)[number],
  );
}

const UNREACHABLE =
  "The sign-in service is unreachable. Try again in a moment.";

/**
 * A temporary password: 16 unambiguous characters grouped for reading
 * aloud (abcd-efgh-…), matching `scripts/create-player-accounts.mjs`.
 */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  // Reject bytes past the last full multiple of the alphabet to avoid bias.
  const limit = 256 - (256 % alphabet.length);
  const chars: string[] = [];
  while (chars.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && chars.length < 16) {
        chars.push(alphabet[byte % alphabet.length]!);
      }
    }
  }
  return chars.join("").match(/.{4}/g)!.join("-");
}

export type PasswordResetResult =
  { ok: true; signedOut: boolean } | { ok: false; message: string };

/**
 * An admin sets another user's password (Better Auth's admin plugin, called
 * with the admin's own session) and signs that user out everywhere. Admin
 * accounts are refused: they're reset manually.
 */
export async function resetUserPassword(
  context: RequestScope,
  userId: string,
  newPassword: string,
): Promise<PasswordResetResult> {
  const auth = createAuth(context);
  const failed = (
    error: { code?: string; message?: string },
    fallback: string,
  ): PasswordResetResult => ({
    ok: false,
    message: isAuthNetworkError(error.code)
      ? UNREACHABLE
      : (error.message ?? fallback),
  });

  const lookup = await auth.admin.listUsers({
    query: {
      filterField: "id",
      filterValue: userId,
      filterOperator: "eq",
      limit: 1,
    },
  });
  if (lookup.error)
    return failed(lookup.error, "Couldn't look up the account.");
  const users = (lookup.data as { users?: { role?: string | null }[] } | null)
    ?.users;
  const user = users?.[0];
  if (!user) {
    return { ok: false, message: "The sign-in account no longer exists." };
  }
  if (hasAdminRole(user.role)) {
    return {
      ok: false,
      message:
        "This player's account is also an admin account; reset it manually.",
    };
  }

  const set = await auth.admin.setUserPassword({ userId, newPassword });
  if (set.error) return failed(set.error, "Couldn't reset the password.");

  const revoked = await auth.admin.revokeUserSessions({ userId });
  return { ok: true, signedOut: !revoked.error };
}

/**
 * Changes the signed-in user's password and signs out their other sessions.
 * Returns an error message, or `undefined` on success.
 */
export async function changePassword(
  context: RequestScope,
  currentPassword: string,
  newPassword: string,
): Promise<{ field?: "currentPassword"; message: string } | undefined> {
  const { error } = await createAuth(context).changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  });
  if (!error) return undefined;
  if (isAuthNetworkError(error.code)) {
    return { message: UNREACHABLE };
  }
  // Neon Auth reports a wrong current password as `invalid_credentials`
  // (Better Auth itself uses INVALID_PASSWORD).
  if (
    error.code === "invalid_credentials" ||
    error.code === "INVALID_PASSWORD"
  ) {
    return { field: "currentPassword", message: "That isn't your password." };
  }
  return { message: error.message ?? "Couldn't change your password." };
}
