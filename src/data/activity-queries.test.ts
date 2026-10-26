import { describe, expect, it, vi } from "vitest";
import { createQueries } from "./queries";
import { isActivityKind } from "./activity-queries";
import type { WeekScoreAuditEntry } from "../types";
import {
  coinData,
  competitionData,
  player,
  shopItem,
  task,
} from "../test/fixtures";

// The selectors are pure; this only stops the db client's `astro:env`
// import loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const data = competitionData({
  players: [player("ann", "Ann"), player("bob", "Bob")],
  tasks: [task({ id: "w3", weekNumber: 3 })],
  coins: coinData({
    items: [shopItem({ id: "hat", name: "Top Hat", price: 20 })],
    purchases: [
      {
        id: 7,
        playerId: "bob",
        itemId: "hat",
        price: 20,
        at: "2026-10-03T09:00:00.000Z",
      },
    ],
    adjustments: [
      {
        id: 4,
        playerId: "ann",
        amount: -5,
        reason: "Late entry",
        actorName: "Taskmaster",
        at: "2026-10-02T09:00:00.000Z",
      },
    ],
    gifts: [
      {
        id: 2,
        fromPlayerId: "ann",
        toPlayerId: "bob",
        amount: 3,
        message: "gg",
        at: "2026-10-05T09:00:00.000Z",
      },
    ],
    miniTasks: [
      {
        id: 9,
        title: "Plant",
        reward: 2,
        startsOn: "2026-10-04",
        endsOn: "2026-10-04",
        status: "ended",
      },
    ],
    miniTaskCompletions: [
      {
        miniTaskId: 9,
        playerId: "bob",
        actorName: "Assistant",
        at: "2026-10-04T12:00:00.000Z",
      },
    ],
  }),
});

const audit: WeekScoreAuditEntry[] = [
  {
    id: 1,
    taskId: "w3",
    at: "2026-10-01T09:00:00.000Z",
    actorName: "Taskmaster",
    entity: "task_score",
    action: "updated",
    subjectId: "ann",
    pointsBefore: 4,
    pointsAfter: 5,
    noteBefore: "ok",
    noteAfter: "great",
  },
];

describe("getActivityLog", () => {
  const { getActivityLog } = createQueries(data);

  it("merges score changes and coin records, newest first", () => {
    const log = getActivityLog(audit);
    expect(log.map((e) => e.id)).toEqual([
      "gift:2",
      "mini-task:9:bob",
      "purchase:7",
      "coin-adjustment:4",
      "score:1",
    ]);
    expect(log.at(-1)).toMatchObject({
      summary: "Week 03 · changed score · Ann: 4 → 5 pts",
      detail: 'note: "ok" → "great"',
      actor: "Taskmaster",
      byAdmin: true,
      href: "/admin/weeks/w3/judge",
    });
    expect(log.find((e) => e.kind === "coin-adjustment")).toMatchObject({
      summary: "Deducted 5 Clim Coin from Ann",
      coins: -5,
    });
    expect(log.find((e) => e.kind === "purchase")).toMatchObject({
      summary: "Bob bought Top Hat",
      actor: "Bob",
      byAdmin: false,
      coins: -20,
    });
    expect(log.find((e) => e.kind === "mini-task")).toMatchObject({
      actor: "Assistant",
      coins: 2,
      href: "/admin/mini-tasks/9",
    });
  });

  it("filters by kind and by who was affected", () => {
    expect(
      getActivityLog(audit, { kind: "mini-task" }).map((e) => e.id),
    ).toEqual(["mini-task:9:bob"]);
    expect(
      getActivityLog(audit, { subjectId: "ann" }).map((e) => e.id),
    ).toEqual(["gift:2", "coin-adjustment:4", "score:1"]);
  });

  it("words a free purchase as a grant, with no coin", () => {
    const { getActivityLog: log } = createQueries(
      competitionData({
        ...data,
        coins: coinData({
          ...data.coins,
          purchases: [
            {
              id: 8,
              playerId: "ann",
              itemId: "hat",
              price: 0,
              at: "2026-10-06T09:00:00.000Z",
            },
          ],
        }),
      }),
    );
    const entry = log([], { kind: "purchase" })[0];
    expect(entry).toMatchObject({ summary: "Ann was given Top Hat" });
    expect(entry).not.toHaveProperty("coins");
  });

  it("recognises its filter kinds", () => {
    expect(isActivityKind("score")).toBe(true);
    expect(isActivityKind("nope")).toBe(false);
    expect(isActivityKind("toString")).toBe(false);
  });
});
