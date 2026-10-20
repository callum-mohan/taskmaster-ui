import { describe, expect, it } from "vitest";
import {
  derivePollBonusRows,
  derivePollStatus,
  mapPolls,
  resolveBonusTask,
} from "./polls";
import {
  at,
  poll,
  pollOptionRow,
  pollRow,
  pollVoteRow,
  task,
} from "../test/fixtures";

// Three back-to-back weeks with a gap after week 2 (UTC; January is GMT).
const week1 = task({
  id: "week-01",
  weekNumber: 1,
  releaseDate: "2026-01-05T09:00:00.000Z",
  deadline: "2026-01-12T09:00:00.000Z",
});
const week2 = task({
  id: "week-02",
  weekNumber: 2,
  releaseDate: "2026-01-12T09:00:00.000Z",
  deadline: "2026-01-19T09:00:00.000Z",
});
const week3 = task({
  id: "week-03",
  weekNumber: 3,
  releaseDate: "2026-01-26T09:00:00.000Z",
  deadline: "2026-02-02T09:00:00.000Z",
});
const schedule = [week1, week2, week3];

describe("derivePollStatus", () => {
  const dates = {
    opensAt: "2026-01-06T12:00:00.000Z",
    closesAt: "2026-01-08T12:00:00.000Z",
  };

  it("is scheduled before it opens", () => {
    expect(derivePollStatus(dates, at("2026-01-06T11:59:59.999Z"))).toBe(
      "scheduled",
    );
  });

  it("opens at the exact opening instant", () => {
    expect(derivePollStatus(dates, at(dates.opensAt))).toBe("open");
  });

  it("closes at the exact closing instant", () => {
    expect(derivePollStatus(dates, at("2026-01-08T11:59:59.999Z"))).toBe(
      "open",
    );
    expect(derivePollStatus(dates, at(dates.closesAt))).toBe("closed");
  });

  it("treats unreadable dates as scheduled", () => {
    const now = at("2030-01-01T00:00:00Z");
    expect(derivePollStatus({ ...dates, opensAt: "soon" }, now)).toBe(
      "scheduled",
    );
    expect(derivePollStatus({ ...dates, closesAt: "" }, now)).toBe("scheduled");
  });
});

describe("resolveBonusTask", () => {
  it("picks the task live when the poll opens", () => {
    expect(resolveBonusTask("2026-01-14T00:00:00.000Z", schedule)).toBe(
      "week-02",
    );
  });

  it("picks the task released at the opening instant over the one closing", () => {
    expect(resolveBonusTask("2026-01-12T09:00:00.000Z", schedule)).toBe(
      "week-02",
    );
  });

  it("falls back to the latest released task between weeks", () => {
    expect(resolveBonusTask("2026-01-20T00:00:00.000Z", schedule)).toBe(
      "week-02",
    );
  });

  it("falls back to the latest task after the season ends", () => {
    expect(resolveBonusTask("2026-03-01T00:00:00.000Z", schedule)).toBe(
      "week-03",
    );
  });

  it("falls back to the first task before the season starts", () => {
    expect(resolveBonusTask("2025-12-01T00:00:00.000Z", schedule)).toBe(
      "week-01",
    );
  });

  it("returns nothing without tasks", () => {
    expect(resolveBonusTask("2026-01-14T00:00:00.000Z", [])).toBeUndefined();
  });
});

describe("mapPolls", () => {
  const now = at("2026-01-07T00:00:00Z");

  it("maps a poll with its dates read as UK time and status derived", () => {
    const [mapped] = mapPolls(
      [
        pollRow({
          opensAt: "2026-07-01 12:00:00",
          closesAt: "2026-07-03 12:00:00",
        }),
      ],
      [],
      [],
      schedule,
      at("2026-07-01T11:00:00Z"),
    );
    expect(mapped.opensAt).toBe("2026-07-01T11:00:00.000Z");
    expect(mapped.closesAt).toBe("2026-07-03T11:00:00.000Z");
    expect(mapped.status).toBe("open");
  });

  it("omits a null description", () => {
    const [plain, described] = mapPolls(
      [pollRow(), pollRow({ id: "other", description: "Be honest." })],
      [],
      [],
      schedule,
      now,
    );
    expect(plain).not.toHaveProperty("description");
    expect(described.description).toBe("Be honest.");
  });

  it("orders only its own options by sort order, then id", () => {
    const [mapped] = mapPolls(
      [pollRow()],
      [
        pollOptionRow(5, 2),
        pollOptionRow(9, 1),
        pollOptionRow(3, 1),
        pollOptionRow(7, 0, "other-poll"),
      ],
      [],
      schedule,
      now,
    );
    expect(mapped.options.map((o) => o.id)).toEqual([3, 9, 5]);
    expect(mapped.options[0]).toEqual({ id: 3, label: "Option 3" });
  });

  it("only attaches its own votes", () => {
    const [mapped] = mapPolls(
      [pollRow()],
      [pollOptionRow(1, 0)],
      [pollVoteRow(1, "alice"), pollVoteRow(8, "bob", "other-poll")],
      schedule,
      now,
    );
    expect(mapped.votes).toEqual([{ optionId: 1, playerId: "alice" }]);
  });

  describe("choice limits", () => {
    const options = [1, 2, 3, 4].map((id) => pollOptionRow(id, id));
    const limits = (row: Parameters<typeof pollRow>[0], opts = options) => {
      const [{ minChoices, maxChoices }] = mapPolls(
        [pollRow(row)],
        opts,
        [],
        schedule,
        now,
      );
      return { minChoices, maxChoices };
    };

    it("forces single-choice polls to exactly one", () => {
      expect(limits({ kind: "single", minChoices: 2, maxChoices: 3 })).toEqual({
        minChoices: 1,
        maxChoices: 1,
      });
    });

    it("lets a multiple-choice poll with no maximum pick every option", () => {
      expect(limits({ kind: "multiple", minChoices: 2 })).toEqual({
        minChoices: 2,
        maxChoices: 4,
      });
    });

    it("caps the maximum at the option count", () => {
      expect(limits({ kind: "multiple", maxChoices: 10 })).toEqual({
        minChoices: 1,
        maxChoices: 4,
      });
    });

    it("keeps a stored maximum below the option count", () => {
      expect(limits({ kind: "multiple", maxChoices: 2 })).toEqual({
        minChoices: 1,
        maxChoices: 2,
      });
    });

    it("never lets the maximum fall below the minimum", () => {
      expect(
        limits({ kind: "multiple", minChoices: 3 }, options.slice(0, 2)),
      ).toEqual({ minChoices: 3, maxChoices: 3 });
    });
  });

  describe("bonus week", () => {
    it("derives the week live when the poll opens", () => {
      const [mapped] = mapPolls(
        [pollRow({ opensAt: "2026-01-14 12:00:00" })],
        [],
        [],
        schedule,
        now,
      );
      expect(mapped.bonusTaskId).toBe("week-02");
      expect(mapped.bonusTaskPinned).toBe(false);
    });

    it("uses an admin's pick", () => {
      const [mapped] = mapPolls(
        [pollRow({ bonusTaskId: "week-03" })],
        [],
        [],
        schedule,
        now,
      );
      expect(mapped.bonusTaskId).toBe("week-03");
      expect(mapped.bonusTaskPinned).toBe(true);
    });

    it("ignores a pick for a task that no longer exists", () => {
      const [mapped] = mapPolls(
        [pollRow({ bonusTaskId: "week-99" })],
        [],
        [],
        schedule,
        now,
      );
      expect(mapped.bonusTaskId).toBe("week-01");
      expect(mapped.bonusTaskPinned).toBe(false);
    });

    it("is absent when there are no tasks", () => {
      const [mapped] = mapPolls([pollRow()], [], [], [], now);
      expect(mapped).not.toHaveProperty("bonusTaskId");
      expect(mapped.bonusTaskPinned).toBe(false);
    });
  });
});

describe("derivePollBonusRows", () => {
  it("awards each voter once, however many options they picked", () => {
    const rows = derivePollBonusRows([
      poll({
        voteBonusPoints: 2,
        votes: [
          { optionId: 1, playerId: "alice" },
          { optionId: 2, playerId: "alice" },
          { optionId: 1, playerId: "bob" },
        ],
      }),
    ]);
    expect(rows).toEqual([
      {
        taskId: "week-01",
        playerId: "alice",
        points: 2,
        reason: 'Voted in the poll "Best snack?"',
      },
      {
        taskId: "week-01",
        playerId: "bob",
        points: 2,
        reason: 'Voted in the poll "Best snack?"',
      },
    ]);
  });

  it("lists polls oldest first", () => {
    const vote = [{ optionId: 1, playerId: "alice" }];
    const rows = derivePollBonusRows([
      poll({
        id: "late",
        question: "Late?",
        opensAt: "2026-01-20T00:00:00.000Z",
        bonusTaskId: "week-02",
        votes: vote,
      }),
      poll({
        id: "early",
        question: "Early?",
        opensAt: "2026-01-06T00:00:00.000Z",
        votes: vote,
      }),
    ]);
    expect(rows.map((r) => r.taskId)).toEqual(["week-01", "week-02"]);
  });

  it("skips polls without a bonus or a bonus week", () => {
    const votes = [{ optionId: 1, playerId: "alice" }];
    expect(
      derivePollBonusRows([
        poll({ voteBonusPoints: 0, votes }),
        poll({ bonusTaskId: undefined, votes }),
      ]),
    ).toEqual([]);
  });

  it("gives nothing for a poll nobody voted in", () => {
    expect(derivePollBonusRows([poll({ votes: [] })])).toEqual([]);
  });

  it("does not reorder the polls it was given", () => {
    const polls = [
      poll({ id: "b", opensAt: "2026-01-20T00:00:00.000Z" }),
      poll({ id: "a", opensAt: "2026-01-06T00:00:00.000Z" }),
    ];
    derivePollBonusRows(polls);
    expect(polls.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
