import { describe, expect, it } from "vitest";
import {
  timestamptzToIso,
  toWallClock,
  ukDateFormat,
  wallClockToIso,
} from "./time";

describe("wallClockToIso", () => {
  it("reads GMT and BST wall-clock times", () => {
    expect(wallClockToIso("2026-01-15 09:30")).toBe("2026-01-15T09:30:00.000Z");
    expect(wallClockToIso("2026-07-15T09:30:15")).toBe(
      "2026-07-15T08:30:15.000Z",
    );
  });

  it("lands either side of the clocks changing", () => {
    // Clocks go forward at 01:00 GMT on 29 March 2026.
    expect(wallClockToIso("2026-03-29 00:59:59")).toBe(
      "2026-03-29T00:59:59.000Z",
    );
    expect(wallClockToIso("2026-03-29 02:00")).toBe("2026-03-29T01:00:00.000Z");
    // Clocks go back at 01:00 GMT on 25 October 2026.
    expect(wallClockToIso("2026-10-25 00:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(wallClockToIso("2026-10-25 02:00")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("returns unreadable input unchanged", () => {
    expect(wallClockToIso("not a date")).toBe("not a date");
  });
});

describe("toWallClock", () => {
  it("formats an instant in UK time", () => {
    expect(toWallClock(new Date("2026-01-15T09:30:05.900Z"))).toBe(
      "2026-01-15 09:30:05",
    );
    expect(toWallClock(new Date("2026-07-15T23:30:00Z"))).toBe(
      "2026-07-16 00:30:00",
    );
  });

  it("switches offset on the hour the clocks change", () => {
    expect(toWallClock(new Date("2026-10-25T00:59:59Z"))).toBe(
      "2026-10-25 01:59:59",
    );
    expect(toWallClock(new Date("2026-10-25T01:00:00Z"))).toBe(
      "2026-10-25 01:00:00",
    );
  });

  it("round-trips with wallClockToIso", () => {
    // (Skips 00:00–01:00Z on 25 October: that wall-clock hour happens twice.)
    for (const iso of [
      "2026-03-29T00:15:00.000Z",
      "2026-03-29T01:45:00.000Z",
      "2026-10-25T01:15:00.000Z",
      "2026-12-31T23:59:59.000Z",
    ]) {
      expect(wallClockToIso(toWallClock(new Date(iso)))).toBe(iso);
    }
  });
});

describe("timestamptzToIso", () => {
  it("normalises Postgres timestamptz strings", () => {
    expect(timestamptzToIso("2026-10-15 13:55:43.12+00")).toBe(
      "2026-10-15T13:55:43.120Z",
    );
    expect(timestamptzToIso("2026-10-15 13:55:43+0530")).toBe(
      "2026-10-15T08:25:43.000Z",
    );
  });
});

describe("ukDateFormat", () => {
  it("formats in UK time and reuses formatters for the same options", () => {
    const options = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    } as const;
    const fmt = ukDateFormat(options);
    expect(fmt.format(new Date("2026-07-15T08:30:00Z"))).toBe("09:30");
    expect(ukDateFormat({ ...options })).toBe(fmt);
  });
});
