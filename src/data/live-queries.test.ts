import { describe, expect, it } from "vitest";
import { createLiveQueries } from "./live-queries";
import { competitionData, player, task, taskScoreRow } from "../test/fixtures";

const weekOne = task({ id: "week-01", weekNumber: 1 });
const weekTwo = task({ id: "week-02", weekNumber: 2 });

describe("getLiveTask", () => {
  it("reads the holds from the snapshot by default", () => {
    const { getLiveTask } = createLiveQueries(
      competitionData({
        tasks: [weekOne, { ...weekTwo, resultsHeld: true }],
      }),
    );
    expect(getLiveTask()?.id).toBe("week-02");
  });

  it("prefers fresh holds over a stale snapshot", () => {
    // The cached snapshot predates the hold and the first reveal.
    const { getLiveTask } = createLiveQueries(
      competitionData({ tasks: [weekOne, weekTwo] }),
    );
    const live = getLiveTask([{ taskId: "week-02", revealCount: 1 }]);
    expect(live?.id).toBe("week-02");
    expect(live?.resultsHeld).toBe(true);
    expect(live?.resultsRevealCount).toBe(1);
  });

  it("is off air once the fresh holds are released", () => {
    // The cached snapshot still thinks the week is held.
    const { getLiveTask } = createLiveQueries(
      competitionData({
        tasks: [{ ...weekOne, resultsHeld: true, resultsRevealCount: 2 }],
      }),
    );
    expect(getLiveTask([])).toBeUndefined();
  });

  it("ignores weeks still open", () => {
    const { getLiveTask } = createLiveQueries(
      competitionData({ tasks: [{ ...weekTwo, status: "live" }] }),
    );
    expect(getLiveTask([{ taskId: "week-02", revealCount: 0 }])).toBe(
      undefined,
    );
  });
});

describe("getLiveShow", () => {
  it("only ranks the given task's rows", () => {
    const { getLiveShow } = createLiveQueries(
      competitionData({
        players: [player("ada"), player("bob")],
        tasks: [weekOne, weekTwo],
      }),
    );
    const show = getLiveShow(
      { ...weekTwo, resultsHeld: true, resultsRevealCount: 1 },
      {
        taskScores: [
          taskScoreRow("week-01", "ada", 9),
          taskScoreRow("week-02", "ada", 5),
          taskScoreRow("week-02", "bob", 3),
        ],
        teamScores: [],
      },
    );
    expect(show.total).toBe(2);
    expect(show.revealed.map((r) => [r.id, r.points])).toEqual([["bob", 3]]);
  });
});
