import { describe, expect, it } from "vitest";
import { deriveTaskStatus, isTaskLocked, mapTasks } from "./tasks";
import { at, taskRow } from "../test/fixtures";
import type { TaskRevealContext } from "../types";

const publicView = (...unlocked: string[]): TaskRevealContext => ({
  mode: "public",
  unlockedTaskIds: new Set(unlocked),
});

describe("deriveTaskStatus", () => {
  const dates = {
    releaseDate: "2026-01-05T09:00:00.000Z",
    deadline: "2026-01-12T09:00:00.000Z",
  };

  it("is upcoming before release", () => {
    expect(deriveTaskStatus(dates, at("2026-01-05T08:59:59.999Z"))).toBe(
      "upcoming",
    );
  });

  it("goes live at the exact release instant", () => {
    expect(deriveTaskStatus(dates, at(dates.releaseDate))).toBe("live");
  });

  it("stays live until just before the deadline", () => {
    expect(deriveTaskStatus(dates, at("2026-01-12T08:59:59.999Z"))).toBe(
      "live",
    );
  });

  it("completes at the exact deadline instant", () => {
    expect(deriveTaskStatus(dates, at(dates.deadline))).toBe("completed");
  });

  it("treats unreadable dates as upcoming", () => {
    const now = at("2030-01-01T00:00:00Z");
    expect(deriveTaskStatus({ ...dates, releaseDate: "not a date" }, now)).toBe(
      "upcoming",
    );
    expect(deriveTaskStatus({ ...dates, deadline: "" }, now)).toBe("upcoming");
  });
});

describe("isTaskLocked", () => {
  const protectedLive = {
    id: "week-02",
    status: "live" as const,
    passwordProtected: true,
    revealedToAll: false,
  };

  it("locks a live password-protected task the visitor hasn't unlocked", () => {
    expect(isTaskLocked(protectedLive, publicView())).toBe(true);
    expect(isTaskLocked(protectedLive, publicView("week-01"))).toBe(true);
  });

  it("unlocks it for a visitor who entered the password", () => {
    expect(isTaskLocked(protectedLive, publicView("week-02"))).toBe(false);
  });

  it("never locks for admins", () => {
    expect(isTaskLocked(protectedLive, { mode: "admin" })).toBe(false);
  });

  it("unlocks once revealed to everyone or completed", () => {
    expect(
      isTaskLocked({ ...protectedLive, revealedToAll: true }, publicView()),
    ).toBe(false);
    expect(
      isTaskLocked({ ...protectedLive, status: "completed" }, publicView()),
    ).toBe(false);
  });

  it("keeps an upcoming protected task locked", () => {
    expect(
      isTaskLocked({ ...protectedLive, status: "upcoming" }, publicView()),
    ).toBe(true);
  });

  it("never locks an unprotected task", () => {
    expect(
      isTaskLocked(
        { ...protectedLive, passwordProtected: false },
        publicView(),
      ),
    ).toBe(false);
  });
});

describe("mapTasks", () => {
  it("reads stored dates as UK wall-clock time (GMT and BST)", () => {
    const [winter, summer] = mapTasks(
      [
        taskRow(),
        taskRow({
          id: "week-30",
          weekNumber: 30,
          releaseDate: "2026-07-01 18:00:00",
          deadline: "2026-07-08 18:00:00",
        }),
      ],
      publicView(),
      at("2026-01-01T00:00:00Z"),
    );
    expect(winter.releaseDate).toBe("2026-01-05T09:00:00.000Z");
    expect(winter.deadline).toBe("2026-01-12T09:00:00.000Z");
    expect(summer.releaseDate).toBe("2026-07-01T17:00:00.000Z");
    expect(summer.deadline).toBe("2026-07-08T17:00:00.000Z");
  });

  it("derives status from the UK-time dates", () => {
    // 09:00 UK in July is 08:00 UTC.
    const row = taskRow({
      releaseDate: "2026-07-01 09:00:00",
      deadline: "2026-07-08 09:00:00",
    });
    const statusAt = (iso: string) =>
      mapTasks([row], publicView(), at(iso))[0].status;
    expect(statusAt("2026-07-01T07:59:59Z")).toBe("upcoming");
    expect(statusAt("2026-07-01T08:00:00Z")).toBe("live");
    expect(statusAt("2026-07-08T08:00:00Z")).toBe("completed");
  });

  it("maps an open task in full", () => {
    const [mapped] = mapTasks(
      [
        taskRow({
          brief: ["Fold it", "Throw it"],
          format: "team",
          maxSubmissions: 2,
          submissionKinds: ["photo", "text"],
          resultsHeldAt: "2026-01-12 10:00:00+00",
          resultsRevealCount: 3,
        }),
      ],
      publicView(),
      at("2026-01-06T00:00:00Z"),
    );
    expect(mapped).toEqual({
      id: "week-01",
      seasonId: "cohort-2026",
      weekNumber: 1,
      title: "Make the best paper plane",
      description: "Furthest flight wins.",
      brief: ["Fold it", "Throw it"],
      releaseDate: "2026-01-05T09:00:00.000Z",
      deadline: "2026-01-12T09:00:00.000Z",
      format: "team",
      status: "live",
      passwordProtected: false,
      revealedToAll: false,
      locked: false,
      submissions: { max: 2, kinds: ["photo", "text"] },
      resultsHeld: true,
      resultsRevealCount: 3,
    });
  });

  it("omits a null brief rather than passing null", () => {
    const [mapped] = mapTasks([taskRow()], publicView());
    expect(mapped).not.toHaveProperty("brief");
  });

  describe("upcoming tasks", () => {
    const beforeRelease = at("2026-01-01T00:00:00Z");
    const row = taskRow({ brief: ["Fold it", "Throw it"] });

    it("withholds the brief from the public until release", () => {
      const [mapped] = mapTasks([row], publicView(), beforeRelease);
      expect(mapped).toMatchObject({
        status: "upcoming",
        title: "Make the best paper plane",
        description: "Furthest flight wins.",
        locked: false,
      });
      expect(mapped).not.toHaveProperty("brief");
    });

    it("withholds it even from a visitor holding a reveal cookie", () => {
      const [mapped] = mapTasks(
        [{ ...row, revealPassword: "swordfish" }],
        publicView("week-01"),
        beforeRelease,
      );
      expect(mapped).not.toHaveProperty("brief");
    });

    it("shows the brief to admins before release", () => {
      const [mapped] = mapTasks([row], { mode: "admin" }, beforeRelease);
      expect(mapped.brief).toEqual(["Fold it", "Throw it"]);
    });
  });

  it("reports no submission kinds while submissions are closed", () => {
    const [mapped] = mapTasks(
      [taskRow({ maxSubmissions: 0, submissionKinds: ["photo"] })],
      publicView(),
    );
    expect(mapped.submissions).toEqual({ max: 0, kinds: [] });
  });

  describe("password-protected tasks", () => {
    const live = at("2026-01-06T00:00:00Z");
    const row = taskRow({
      revealPassword: "swordfish",
      brief: "Secret brief",
    });

    it("redacts title, description and brief while locked", () => {
      const [mapped] = mapTasks([row], publicView(), live);
      expect(mapped).toMatchObject({
        title: "???",
        description: "",
        locked: true,
        passwordProtected: true,
      });
      expect(mapped).not.toHaveProperty("brief");
      expect(JSON.stringify(mapped)).not.toContain("swordfish");
    });

    it("shows content to a visitor who unlocked it", () => {
      const [mapped] = mapTasks([row], publicView("week-01"), live);
      expect(mapped).toMatchObject({
        title: "Make the best paper plane",
        brief: "Secret brief",
        locked: false,
      });
    });

    it("shows content once revealed to everyone", () => {
      const [mapped] = mapTasks(
        [{ ...row, revealedAt: "2026-01-06 08:00:00" }],
        publicView(),
        live,
      );
      expect(mapped).toMatchObject({ revealedToAll: true, locked: false });
    });

    it("opens up after the deadline", () => {
      const [mapped] = mapTasks(
        [row],
        publicView(),
        at("2026-01-12T09:00:00Z"),
      );
      expect(mapped).toMatchObject({ status: "completed", locked: false });
    });

    it("shows content to admins", () => {
      const [mapped] = mapTasks([row], { mode: "admin" }, live);
      expect(mapped.locked).toBe(false);
      expect(mapped.title).toBe("Make the best paper plane");
    });
  });
});
