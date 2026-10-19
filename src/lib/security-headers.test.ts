import { describe, expect, it } from "vitest";
import { securityHeaders, withSecurityHeaders } from "./security-headers";

const HTTPS = new URL("https://eayltaskmaster.co.uk/tasks");
const HTTP = new URL("http://localhost:4321/tasks");

describe("securityHeaders", () => {
  it("forbids framing and plugins", () => {
    const headers = securityHeaders(HTTPS);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
  });

  it("leaves scripts, styles and images unrestricted", () => {
    const csp = securityHeaders(HTTPS)["Content-Security-Policy"];
    expect(csp).not.toMatch(/(default|script|style|img)-src/);
  });

  it("sends HSTS over https only", () => {
    expect(securityHeaders(HTTPS)["Strict-Transport-Security"]).toBeDefined();
    expect(securityHeaders(HTTP)["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers to a response", () => {
    const response = withSecurityHeaders(new Response("ok"), HTTPS);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps headers a route set itself", () => {
    const response = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
      HTTPS,
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("copies responses whose headers are immutable", () => {
    const original = Response.redirect("https://eayltaskmaster.co.uk/", 302);
    const response = withSecurityHeaders(original, HTTPS);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://eayltaskmaster.co.uk/",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
