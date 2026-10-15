import { NEON_AUTH_COOKIE_SECRET } from "astro:env/server";
import { env } from "cloudflare:workers";
import type { AstroCookies, AstroCookieSetOptions } from "astro";

// Password-protected tasks: a visitor who enters the shared reveal password
// gets a per-task HttpOnly cookie holding an HMAC of the task id and the
// normalised password. Verifying it needs the current password, so changing
// the password re-locks the task for everyone who unlocked the old one.

const COOKIE_PREFIX = "tm_reveal_";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days; a task runs ~a week.

/** Matching is forgiving: surrounding spaces and case are ignored. */
export const normaliseRevealPassword = (value: string) =>
  value.trim().toLowerCase();

export const revealCookieName = (taskId: string) => `${COOKIE_PREFIX}${taskId}`;

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | undefined;

function signingKey(): Promise<CryptoKey> {
  // Derived from the existing auth secret with a distinct label, so reveal
  // cookies can never be swapped for session cookies (or vice versa).
  return (keyPromise ??= crypto.subtle
    .importKey(
      "raw",
      encoder.encode(NEON_AUTH_COOKIE_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    .then(async (root) => {
      const derived = await crypto.subtle.sign(
        "HMAC",
        root,
        encoder.encode("taskmaster:task-reveal:v1"),
      );
      return crypto.subtle.importKey(
        "raw",
        derived,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
    }));
}

const toBase64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The cookie value proving the visitor knew `password` for `taskId`. */
export async function revealToken(
  taskId: string,
  password: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(`${taskId}\n${normaliseRevealPassword(password)}`),
  );
  return toBase64Url(signature);
}

/** Length-independent comparison so timing doesn't leak how much matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function passwordMatches(guess: string, password: string): boolean {
  return constantTimeEqual(
    normaliseRevealPassword(guess),
    normaliseRevealPassword(password),
  );
}

/** Every `tm_reveal_*` cookie on the request, keyed by task id. */
export function readRevealCookies(request: Request): Map<string, string> {
  const tokens = new Map<string, string>();
  const header = request.headers.get("cookie");
  if (!header) return tokens;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName?.startsWith(COOKIE_PREFIX)) continue;
    const taskId = rawName.slice(COOKIE_PREFIX.length);
    if (taskId) tokens.set(taskId, rest.join("="));
  }
  return tokens;
}

/**
 * The ids of password-protected tasks this request's cookies unlock.
 * `passwords` maps task id → current reveal password.
 */
export async function unlockedTaskIds(
  tokens: ReadonlyMap<string, string>,
  passwords: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const unlocked = new Set<string>();
  await Promise.all(
    [...tokens].map(async ([taskId, token]) => {
      const password = passwords.get(taskId);
      if (!password) return;
      if (constantTimeEqual(token, await revealToken(taskId, password))) {
        unlocked.add(taskId);
      }
    }),
  );
  return unlocked;
}

export async function setRevealCookie(
  cookies: AstroCookies,
  taskId: string,
  password: string,
  secure: boolean,
): Promise<void> {
  const options: AstroCookieSetOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: COOKIE_MAX_AGE,
  };
  cookies.set(
    revealCookieName(taskId),
    await revealToken(taskId, password),
    options,
  );
}

/**
 * Per-IP throttle on password guesses via the Workers rate-limiting binding
 * (`TASK_REVEAL_LIMITER` in `wrangler.jsonc`). Returns true when the attempt
 * may proceed; without the binding (e.g. some local setups) it always does.
 */
export async function allowRevealAttempt(
  clientIp: string,
  taskId: string,
): Promise<boolean> {
  const limiter = env.TASK_REVEAL_LIMITER;
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: `${clientIp}:${taskId}` });
    return success;
  } catch {
    return true;
  }
}
