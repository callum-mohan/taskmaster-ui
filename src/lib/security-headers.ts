// Security headers added to every response the Worker renders. The CSP only
// covers directives that don't depend on page content (framing, <base>, form
// targets, plugins), so inline theme scripts, Google Fonts and presigned
// photo URLs keep working without per-page hashes.

const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

export function securityHeaders(url: URL): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    // Local dev runs over plain http, where HSTS would be ignored anyway.
    ...(url.protocol === "https:" && {
      "Strict-Transport-Security": "max-age=31536000",
    }),
  };
}

/**
 * Adds the security headers without overriding any a route set itself.
 * Some responses (e.g. `Response.redirect`) have immutable headers, so those
 * are copied into a new response first.
 */
export function withSecurityHeaders(response: Response, url: URL): Response {
  const apply = (target: Headers) => {
    for (const [name, value] of Object.entries(securityHeaders(url))) {
      if (!target.has(name)) target.set(name, value);
    }
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    apply(copy.headers);
    return copy;
  }
}
