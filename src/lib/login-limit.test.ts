import { beforeEach, describe, expect, it, vi } from "vitest";

const workerEnv = vi.hoisted(
  () =>
    ({}) as {
      LOGIN_LIMITER?: {
        limit: (options: { key: string }) => Promise<{ success: boolean }>;
      };
    },
);
vi.mock("cloudflare:workers", () => ({ env: workerEnv }));

const { allowLoginAttempt, requestClientIp } = await import("./login-limit");

describe("requestClientIp", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.com/login", { headers });

  it("prefers Cloudflare's connecting-IP header", () => {
    expect(
      requestClientIp(
        request({ "cf-connecting-ip": "203.0.113.7" }),
        () => "127.0.0.1",
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to the socket address", () => {
    expect(requestClientIp(request(), () => "127.0.0.1")).toBe("127.0.0.1");
  });

  it("copes when the address is unavailable", () => {
    const unavailable = () => {
      throw new Error("clientAddress is not available");
    };
    expect(requestClientIp(request(), unavailable)).toBe("unknown");
  });
});

describe("allowLoginAttempt", () => {
  beforeEach(() => {
    delete workerEnv.LOGIN_LIMITER;
  });

  it("allows every attempt without the binding", async () => {
    expect(await allowLoginAttempt("203.0.113.7")).toBe(true);
  });

  it("keys the limit on the visitor's IP", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    workerEnv.LOGIN_LIMITER = { limit };
    expect(await allowLoginAttempt("203.0.113.7")).toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: "login:203.0.113.7" });
  });

  it("blocks once the limit is reached", async () => {
    workerEnv.LOGIN_LIMITER = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    };
    expect(await allowLoginAttempt("203.0.113.7")).toBe(false);
  });

  it("fails open if the limiter errors", async () => {
    workerEnv.LOGIN_LIMITER = {
      limit: vi.fn().mockRejectedValue(new Error("unavailable")),
    };
    expect(await allowLoginAttempt("203.0.113.7")).toBe(true);
  });
});
