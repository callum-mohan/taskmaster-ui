import { describe, expect, it, vi } from "vitest";
import { deriveMiniTaskStatus, mapMiniTasks, ukToday } from "./mini-tasks";
import { deriveWallet } from "./coins";
import { createQueries } from "./queries";
import type { MiniTask, MiniTaskCompletion } from "../types";
import { at, coinData, competitionData, player } from "../test/fixtures";

// Pure derivations; this only stops the db client's `astro:env` import
// loading (some query modules sit beside their writes).
vi.mock("../db", () => ({ getDb: () => undefined }));

const miniTask = (overrides: Partial<MiniTask> = {}): MiniTask => ({
  id: 1,
  title: "Bring a plant",
  reward: 3,
  startsOn: "2026-10-26",
  endsOn: "2026-10-26",
  status: "active",
  ...overrides,
});

const completion = (
  overrides: Partial<MiniTaskCompletion> = {},
): MiniTaskCompletion => ({
  miniTaskId: 1,
  playerId: "ann",
  actorName: "Taskmaster",
  at: "2026-10-26T10:00:00.000Z",
  ...overrides,
});

describe("ukToday", () => {
  it("uses the UK calendar day, not UTC", () => {
    // 23:30 UTC in summer is already the next day in London (BST).
    expect(ukToday(at("2026-07-01T23:30:00.000Z"))).toBe("2026-07-02");
    expect(ukToday(at("2026-12-01T23:30:00.000Z"))).toBe("2026-12-01");
  });
});

describe("deriveMiniTaskStatus", () => {
  const window = { startsOn: "2026-10-26", endsOn: "2026-10-28" };
  it("is active on both inclusive end days", () => {
    expect(deriveMiniTaskStatus(window, "2026-10-26")).toBe("active");
    expect(deriveMiniTaskStatus(window, "2026-10-28")).toBe("active");
  });
  it("is upcoming before and ended after", () => {
    expect(deriveMiniTaskStatus(window, "2026-10-25")).toBe("upcoming");
    expect(deriveMiniTaskStatus(window, "2026-10-29")).toBe("ended");
  });
});

describe("mapMiniTasks", () => {
  const row = (id: number, startsOn: string, endsOn = startsOn) => ({
    id,
    seasonId: "s",
    title: `T${id}`,
    description: "",
    reward: 2,
    startsOn,
    endsOn,
    createdAt: "2026-10-01 00:00:00+00",
    updatedAt: "2026-10-01 00:00:00+00",
  });

  it("orders newest first, drops blank descriptions and derives status", () => {
    const mapped = mapMiniTasks(
      [row(1, "2026-10-20"), row(2, "2026-10-27"), row(3, "2026-10-26")],
      at("2026-10-26T12:00:00.000Z"),
    );
    expect(mapped.map((t) => [t.id, t.status])).toEqual([
      [2, "upcoming"],
      [3, "active"],
      [1, "ended"],
    ]);
    expect(mapped[0]).not.toHaveProperty("description");
  });
});

describe("mini-task earnings", () => {
  const data = competitionData({
    players: [player("ann"), player("bob")],
    coins: coinData({
      miniTasks: [
        miniTask(),
        miniTask({ id: 2, title: "Wear a hat", reward: 5 }),
      ],
      miniTaskCompletions: [
        completion(),
        completion({ miniTaskId: 2, at: "2026-10-26T11:00:00.000Z" }),
        completion({ playerId: "bob" }),
      ],
    }),
  });

  it("pays each completion's reward into the player's wallet", () => {
    const wallet = deriveWallet(data, "ann");
    expect(wallet.earned).toBe(8);
    expect(wallet.balance).toBe(8);
    expect(wallet.ledger.filter((e) => e.kind === "mini-task")).toEqual([
      {
        kind: "mini-task",
        amount: 5,
        label: "Mini-task: Wear a hat",
        at: "2026-10-26T11:00:00.000Z",
      },
      {
        kind: "mini-task",
        amount: 3,
        label: "Mini-task: Bring a plant",
        at: "2026-10-26T10:00:00.000Z",
      },
    ]);
    expect(deriveWallet(data, "bob").balance).toBe(3);
  });

  it("builds the board with the player's progress and counts", () => {
    const { getMiniTaskBoard } = createQueries(
      competitionData({
        ...data,
        coins: coinData({
          ...data.coins,
          miniTasks: [
            ...data.coins.miniTasks,
            miniTask({
              id: 3,
              title: "Later",
              status: "upcoming",
              startsOn: "2026-10-30",
              endsOn: "2026-10-30",
            }),
          ],
        }),
      }),
    );
    const board = getMiniTaskBoard("bob");
    expect(
      board.active.map((v) => [v.task.id, v.completed, v.completions]),
    ).toEqual([
      [1, true, 2],
      [2, false, 1],
    ]);
    expect(board.upcoming.map((v) => v.task.id)).toEqual([3]);
    expect(board).toMatchObject({ completedCount: 1, coinsEarned: 3 });
    expect(getMiniTaskBoard().active.every((v) => !v.completed)).toBe(true);
  });

  it("notifies the player when they're ticked off", () => {
    const { getNotifications } = createQueries(data);
    const feed = getNotifications({
      playerId: "ann",
      now: at("2026-10-27T00:00:00.000Z"),
    });
    expect(
      feed.items.filter((i) => i.kind === "mini-task").map((i) => i.title),
    ).toEqual(["Mini-task done: +5 Clim Coin", "Mini-task done: +3 Clim Coin"]);
  });
});
