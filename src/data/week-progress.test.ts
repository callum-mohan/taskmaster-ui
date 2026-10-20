import { describe, expect, it } from "vitest";
import { EMPTY_WEEK_COUNTS, getWeekProgress } from "./week-progress";
import { task } from "../test/fixtures";
import type { WeekCounts, WeekStepId } from "../types";

const roster = { players: 4, teams: 2 };
const counts = (overrides: Partial<WeekCounts> = {}): WeekCounts => ({
  ...EMPTY_WEEK_COUNTS,
  ...overrides,
});
const states = (progress: ReturnType<typeof getWeekProgress>) =>
  Object.fromEntries(progress.steps.map((s) => [s.id, s.state])) as Record<
    WeekStepId,
    string
  >;

describe("getWeekProgress", () => {
  it("links each step to its tab", () => {
    const { steps } = getWeekProgress(
      task({ id: "week-05" }),
      counts(),
      roster,
    );
    expect(steps.map((s) => s.href)).toEqual([
      "/admin/weeks/week-05",
      "/admin/weeks/week-05/judge",
      "/admin/weeks/week-05/live",
      "/admin/weeks/week-05/recap",
    ]);
  });

  it("asks for nothing on an upcoming week", () => {
    const progress = getWeekProgress(
      task({ status: "upcoming" }),
      counts(),
      roster,
    );
    expect(states(progress)).toEqual({
      brief: "optional",
      judge: "waiting",
      live: "optional",
      recap: "waiting",
    });
    expect(progress.next).toBeUndefined();
  });

  it("counts entries so far on a live week that takes them", () => {
    const progress = getWeekProgress(
      task({ status: "live", submissions: { max: 1, kinds: ["photo"] } }),
      counts({ entries: 3 }),
      roster,
    );
    expect(progress.steps[1]).toMatchObject({
      state: "waiting",
      detail: "3 entries so far",
    });
    expect(progress.next).toBeUndefined();
  });

  it("points at judging once a week finishes unscored", () => {
    const progress = getWeekProgress(task(), counts(), roster);
    expect(progress.next?.id).toBe("judge");
    expect(progress.steps[1].detail).toBe("not scored");
  });

  it("keeps judging active until everyone is scored", () => {
    const partly = getWeekProgress(
      task(),
      counts({ individualScores: 2 }),
      roster,
    );
    expect(partly.next?.id).toBe("judge");
    expect(partly.steps[1].detail).toBe("2 / 4 scored");

    const fully = getWeekProgress(
      task(),
      counts({ individualScores: 4 }),
      roster,
    );
    expect(states(fully)).toEqual({
      brief: "done",
      judge: "done",
      live: "done",
      recap: "optional",
    });
    expect(fully.next).toBeUndefined();
  });

  it("scores team weeks against squads, not players", () => {
    const progress = getWeekProgress(
      task({ format: "team" }),
      counts({ individualScores: 4, teamScores: 2 }),
      roster,
    );
    expect(progress).toMatchObject({ scored: 2, roster: 2 });
    expect(progress.steps[1].state).toBe("done");
  });

  it("points at results night while results are held", () => {
    const progress = getWeekProgress(
      task({ resultsHeld: true, resultsRevealCount: 2 }),
      counts({ individualScores: 4 }),
      roster,
    );
    expect(progress.next?.id).toBe("live");
    expect(progress.steps[2].detail).toBe("held · 2 revealed");
    // Held results aren't public, so the recap page isn't up yet.
    expect(progress.steps[3].state).toBe("waiting");
  });

  it("marks a written recap done", () => {
    const progress = getWeekProgress(
      task(),
      counts({ individualScores: 4, recapWritten: true }),
      roster,
    );
    expect(progress.steps[3]).toMatchObject({
      state: "done",
      detail: "written",
    });
  });
});
