import { env } from "cloudflare:workers";

/**
 * The visitor's IP: Cloudflare's header in production, the socket address
 * locally (which some setups can't provide).
 */
export function requestClientIp(
  request: Request,
  clientAddress: () => string,
): string {
  const header = request.headers.get("cf-connecting-ip");
  if (header) return header;
  try {
    return clientAddress() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Per-IP throttle on sign-in attempts via the Workers rate-limiting binding
 * (`LOGIN_LIMITER` in `wrangler.jsonc`), so leaked passwords can't be tried
 * in bulk. Keyed on IP alone so spraying many emails is throttled too.
 * Returns true when the attempt may proceed; without the binding (e.g. some
 * local setups) it always does.
 */
export async function allowLoginAttempt(clientIp: string): Promise<boolean> {
  const limiter = env.LOGIN_LIMITER;
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: `login:${clientIp}` });
    return success;
  } catch {
    return true;
  }
}
