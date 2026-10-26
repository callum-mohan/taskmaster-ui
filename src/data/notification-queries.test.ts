import { describe, expect, it } from "vitest";
import { createNotificationQueries } from "./notification-queries";
import { at, competitionData, poll, shopItem, task } from "../test/fixtures";
import type {
  CompetitionData,
  NotificationItem,
  PlayerRankChange,
} from "../types";

// Week 1 has finished and been scored; week 2 (a team task, in BST) is live.
const week1 = task({
  id: "week-01",
  weekNumber: 1,
  releaseDate: "2026-06-22T08:00:00.000Z",
  deadline: "2026-06-29T08:00:00.000Z",
  status: "completed",
});
const week2 = task({
  id: "week-02",
  weekNumber: 2,
  title: "Build a tower",
  format: "team",
  releaseDate: "2026-06-29T08:00:00.000Z",
  deadline: "2026-07-03T17:00:00.000Z",
  status: "live",
});
const week3 = task({
  id: "week-03",
  weekNumber: 3,
  releaseDate: "2026-07-06T08:00:00.000Z",
  deadline: "2026-07-13T08:00:00.000Z",
  status: "upcoming",
});

/** Monday of week 2, before its deadline reminder starts. */
const NOW = at("2026-07-01T12:00:00Z");

function feedFor(
  data: Partial<CompetitionData>,
  options: Parameters<
    ReturnType<typeof createNotificationQueries>["getNotifications"]
  >[0] = {},
  rankHistory: PlayerRankChange[] = [],
) {
  const { getNotifications } = createNotificationQueries(
    competitionData({ tasks: [week1, week2, week3], ...data }),
    { getPlayerRankHistory: () => rankHistory },
  );
  return getNotifications({ now: NOW, ...options });
}

const byId = (items: NotificationItem[], id: string) =>
  items.find((item) => item.id === id);

describe("getNotifications", () => {
  describe("task releases", () => {
    it("announces tasks once released, never before", () => {
      const { items } = feedFor({});
      expect(items.map((i) => i.id)).toEqual(["task:week-02", "task:week-01"]);
      expect(items[0]).toEqual({
        id: "task:week-02",
        kind: "task-released",
        title: "Build a tower",
        detail: "Week 02 · team task",
        href: "/tasks/week-02",
        at: week2.releaseDate,
        unread: true,
      });
    });

    it("names a locked task only by its week", () => {
      const locked = { ...week2, title: "???", description: "", locked: true };
      const { items } = feedFor({ tasks: [week1, locked, week3] });
      expect(byId(items, "task:week-02")).toMatchObject({
        title: "Week 02 brief",
        detail: "Week 02 · team task · locked",
      });
    });
  });

  describe("deadline reminders", () => {
    it("appears 24 hours before a live task closes", () => {
      const { items } = feedFor({}, { now: at("2026-07-02T17:00:00Z") });
      expect(byId(items, "deadline:week-02")).toEqual({
        id: "deadline:week-02",
        kind: "deadline-soon",
        title: "Deadline in 24h: Build a tower",
        // 17:00 UTC is 18:00 in the UK in July.
        detail: "Week 02 · closes Fri 18:00",
        href: "/tasks/week-02",
        at: "2026-07-02T17:00:00.000Z",
        unread: true,
      });
    });

    it("is not shown earlier than that", () => {
      const { items } = feedFor({}, { now: at("2026-07-02T16:59:59Z") });
      expect(byId(items, "deadline:week-02")).toBeUndefined();
    });

    it("disappears once the deadline passes", () => {
      const { items } = feedFor({}, { now: at(week2.deadline) });
      expect(byId(items, "deadline:week-02")).toBeUndefined();
    });

    it("dates from the release for a task shorter than a day", () => {
      const short = {
        ...week2,
        releaseDate: "2026-07-03T09:00:00.000Z",
      };
      const { items } = feedFor(
        { tasks: [week1, short] },
        { now: at("2026-07-03T10:00:00Z") },
      );
      expect(byId(items, "deadline:week-02")?.at).toBe(short.releaseDate);
    });

    it("only reminds about live tasks", () => {
      const { items } = feedFor(
        { tasks: [{ ...week2, status: "completed" }] },
        { now: at("2026-07-03T12:00:00Z") },
      );
      expect(byId(items, "deadline:week-02")).toBeUndefined();
    });
  });

  describe("results", () => {
    const resultsPostedAt = { "week-01": "2026-06-29T20:00:00.000Z" };

    it("announces posted results without an outcome when signed out", () => {
      const { items } = feedFor({ resultsPostedAt });
      expect(byId(items, "results:week-01")).toEqual({
        id: "results:week-01",
        kind: "results-posted",
        title: "Results are in for Week 01",
        detail: "Make the best paper plane",
        href: "/tasks/week-01#results",
        at: "2026-06-29T20:00:00.000Z",
        unread: true,
      });
    });

    it.each([
      [1, 1, "you came 1st with 1 pt"],
      [2, 5, "you came 2nd with 5 pts"],
      [3, 0, "you came 3rd with 0 pts"],
      [4, 2, "you came 4th with 2 pts"],
      [11, 2, "you came 11th with 2 pts"],
      [12, 2, "you came 12th with 2 pts"],
      [13, 2, "you came 13th with 2 pts"],
      [21, 2, "you came 21st with 2 pts"],
      [22, 2, "you came 22nd with 2 pts"],
      [23, 2, "you came 23rd with 2 pts"],
      [111, 2, "you came 111th with 2 pts"],
    ])("describes position %i with %i points", (position, points, outcome) => {
      const { items } = feedFor(
        {
          resultsPostedAt,
          scores: [{ taskId: "week-01", playerId: "alice", points, position }],
        },
        { playerId: "alice" },
      );
      expect(byId(items, "results:week-01")?.detail).toBe(
        `Make the best paper plane · ${outcome}`,
      );
    });

    it("speaks of the squad on a team task", () => {
      const { items } = feedFor(
        {
          resultsPostedAt: { "week-02": "2026-07-01T09:00:00.000Z" },
          scores: [
            { taskId: "week-02", playerId: "alice", points: 9, position: 1 },
          ],
        },
        { playerId: "alice" },
      );
      expect(byId(items, "results:week-02")?.detail).toBe(
        "Build a tower · your squad came 1st with 9 pts",
      );
    });

    it("tells a player who wasn't scored", () => {
      const { items } = feedFor({ resultsPostedAt }, { playerId: "bob" });
      expect(byId(items, "results:week-01")?.detail).toBe(
        "Make the best paper plane · you weren't scored",
      );
    });

    it("waits until the results are posted", () => {
      const { items } = feedFor({
        resultsPostedAt: { "week-01": "2026-07-01T12:00:00.001Z" },
      });
      expect(byId(items, "results:week-01")).toBeUndefined();
    });
  });

  describe("rank climbs", () => {
    const climb = (
      rank: number,
      previousRank: number,
      when = "2026-06-29T20:00:00.000Z",
    ): PlayerRankChange => ({ task: week1, rank, previousRank, at: when });

    it("celebrates moving up", () => {
      const { items } = feedFor({}, { playerId: "alice" }, [climb(2, 5)]);
      expect(byId(items, "rank:week-01")).toEqual({
        id: "rank:week-01",
        kind: "rank-up",
        title: "You moved up to #2",
        detail: "Week 01 results · up from #5",
        href: "/leaderboard",
        at: "2026-06-29T20:00:00.000Z",
        unread: true,
      });
    });

    it("stays quiet when holding or losing a place", () => {
      for (const change of [climb(3, 3), climb(4, 3)]) {
        const { items } = feedFor({}, { playerId: "alice" }, [change]);
        expect(byId(items, "rank:week-01")).toBeUndefined();
      }
    });

    it("ignores climbs dated in the future", () => {
      const { items } = feedFor({}, { playerId: "alice" }, [
        climb(1, 2, "2026-07-02T00:00:00.000Z"),
      ]);
      expect(byId(items, "rank:week-01")).toBeUndefined();
    });

    it("is only shown to a signed-in player", () => {
      const { items } = feedFor({}, {}, [climb(1, 2)]);
      expect(byId(items, "rank:week-01")).toBeUndefined();
    });

    it("sorts above the results posted at the same moment", () => {
      const { items } = feedFor(
        { resultsPostedAt: { "week-01": "2026-06-29T20:00:00.000Z" } },
        { playerId: "alice" },
        [climb(1, 2)],
      );
      const ids = items.map((i) => i.id);
      expect(ids.indexOf("rank:week-01")).toBe(
        ids.indexOf("results:week-01") - 1,
      );
    });
  });

  describe("bonuses and deductions", () => {
    const awardedAt = "2026-06-30T10:00:00.000Z";

    it("reports a bonus with its reason and week", () => {
      const { items } = feedFor(
        {
          bonusPoints: [
            {
              taskId: "week-01",
              playerId: "alice",
              points: 3,
              reason: "Best costume",
              id: 7,
              awardedAt,
            },
          ],
        },
        { playerId: "alice" },
      );
      expect(byId(items, "bonus:7")).toEqual({
        id: "bonus:7",
        kind: "bonus-awarded",
        title: "You got +3 bonus points",
        detail: "Best costume · Week 01",
        href: "/players/alice#bonus-heading",
        at: awardedAt,
        unread: true,
      });
    });

    it("pluralises a single point", () => {
      const { items } = feedFor(
        {
          bonusPoints: [
            {
              taskId: "week-01",
              playerId: "alice",
              points: 1,
              reason: "Tidy",
              id: 1,
              awardedAt,
            },
            {
              taskId: "week-01",
              playerId: "alice",
              points: -1,
              reason: "Late",
              id: 2,
              awardedAt,
            },
          ],
        },
        { playerId: "alice" },
      );
      expect(byId(items, "bonus:1")?.title).toBe("You got +1 bonus point");
      expect(byId(items, "bonus:2")?.title).toBe("You lost 1 point");
    });

    it("reports a deduction", () => {
      const { items } = feedFor(
        {
          bonusPoints: [
            {
              taskId: "week-01",
              playerId: "alice",
              points: -2,
              reason: "Late entry",
              id: 8,
              awardedAt,
            },
          ],
        },
        { playerId: "alice" },
      );
      expect(byId(items, "bonus:8")).toMatchObject({
        kind: "points-deducted",
        title: "You lost 2 points",
      });
    });

    it("skips other players, derived poll bonuses and future awards", () => {
      const { items } = feedFor(
        {
          bonusPoints: [
            {
              taskId: "week-01",
              playerId: "bob",
              points: 3,
              reason: "x",
              id: 1,
              awardedAt,
            },
            { taskId: "week-01", playerId: "alice", points: 1, reason: "Poll" },
            {
              taskId: "week-01",
              playerId: "alice",
              points: 3,
              reason: "x",
              id: 2,
              awardedAt: "2026-07-02T00:00:00.000Z",
            },
          ],
        },
        { playerId: "alice" },
      );
      expect(items.filter((i) => i.id.startsWith("bonus:"))).toEqual([]);
    });
  });

  describe("polls", () => {
    it("announces opened, published polls", () => {
      const { items } = feedFor({
        polls: [
          poll({
            id: "best snack",
            opensAt: "2026-07-01T09:00:00.000Z",
            status: "open",
          }),
          poll({
            id: "old",
            opensAt: "2026-06-23T09:00:00.000Z",
            status: "closed",
          }),
          poll({
            id: "draft",
            opensAt: "2026-06-30T09:00:00.000Z",
            published: false,
          }),
          poll({ id: "later", opensAt: "2026-07-02T09:00:00.000Z" }),
        ],
      });
      const polls = items.filter((i) => i.kind === "poll-opened");
      expect(polls.map((p) => [p.id, p.detail])).toEqual([
        ["poll:best snack", "voting open"],
        ["poll:old", "voting closed"],
      ]);
      expect(polls[0].href).toBe("/#poll-best%20snack");
    });
  });

  describe("ordering and read state", () => {
    const resultsPostedAt = { "week-01": "2026-06-29T20:00:00.000Z" };

    it("lists newest first", () => {
      const { items } = feedFor({ resultsPostedAt });
      const times = items.map((i) => at(i.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(items.map((i) => i.id)).toEqual([
        "results:week-01",
        "task:week-02",
        "task:week-01",
      ]);
    });

    it("keeps only the newest `limit` items", () => {
      const { items, unreadCount } = feedFor({ resultsPostedAt }, { limit: 2 });
      expect(items.map((i) => i.id)).toEqual([
        "results:week-01",
        "task:week-02",
      ]);
      expect(unreadCount).toBe(2);
    });

    it("marks everything unread when the feed was never opened", () => {
      const { items, unreadCount } = feedFor({ resultsPostedAt });
      expect(items.every((i) => i.unread)).toBe(true);
      expect(unreadCount).toBe(3);
    });

    it("marks only what happened after the last read as unread", () => {
      const { items, unreadCount } = feedFor(
        { resultsPostedAt },
        // Exactly when week 2 was released: that counts as read.
        { readAt: week2.releaseDate },
      );
      expect(items.map((i) => [i.id, i.unread])).toEqual([
        ["results:week-01", true],
        ["task:week-02", false],
        ["task:week-01", false],
      ]);
      expect(unreadCount).toBe(1);
    });
  });

  describe("sabotages", () => {
    const sabotage = {
      id: 7,
      taskId: "week-02",
      effect: "sabotage" as const,
      label: "sabotaged Ann",
      player: { id: "bob", seasonId: "cohort-2026", name: "Bob" },
      at: "2026-06-30T09:00:00.000Z",
    };
    const feed = (now = NOW) =>
      createNotificationQueries(
        competitionData({ tasks: [week1, week2, week3] }),
        {
          getPlayerRankHistory: () => [],
          getSabotagesOf: (id) => (id === "ann" ? [sabotage] : []),
        },
      ).getNotifications({ now, playerId: "ann" });

    it("tells the target who sabotaged them, and in which week", () => {
      expect(byId(feed().items, "sabotage:7")).toEqual({
        id: "sabotage:7",
        kind: "sabotaged",
        title: "Bob sabotaged you",
        detail: "5 points lost · Week 02",
        href: "/tasks/week-02#power-ups",
        at: sabotage.at,
        unread: true,
      });
    });

    it("doesn't show it before it happened", () => {
      expect(
        byId(feed(at("2026-06-30T08:00:00Z")).items, "sabotage:7"),
      ).toBeUndefined();
    });
  });

  describe("shields and mirrors", () => {
    const ann = { id: "ann", seasonId: "cohort-2026", name: "Ann" };
    const bob = { id: "bob", seasonId: "cohort-2026", name: "Bob" };
    const bounced = {
      id: 7,
      taskId: "week-01",
      effect: "sabotage" as const,
      label: "sabotaged Ann, but it bounced off Ann's Mirror",
      player: bob,
      target: ann,
      outcome: "reflected" as const,
      at: "2026-06-25T09:00:00.000Z",
    };
    const RESULTS = "2026-06-30T20:00:00.000Z";
    const feed = (playerId: string, now = NOW) =>
      createNotificationQueries(
        competitionData({
          tasks: [week1, week2, week3],
          resultsPostedAt: { "week-01": RESULTS },
        }),
        {
          getPlayerRankHistory: () => [],
          getSabotagesOf: (id) => (id === "ann" ? [bounced] : []),
          getSabotagesBy: (id) => (id === "bob" ? [bounced] : []),
        },
      ).getNotifications({ now, playerId });

    it("tells both sides once the week's results are out", () => {
      expect(byId(feed("ann").items, "defended:7")).toMatchObject({
        kind: "shielded",
        title: "Your Mirror bounced Bob's Sabotage back",
        detail: "no points lost · Week 01",
        at: RESULTS,
      });
      expect(byId(feed("ann").items, "sabotage:7")?.detail).toBe(
        "no points lost · Week 01",
      );
      expect(byId(feed("bob").items, "reflected:7")).toMatchObject({
        kind: "reflected",
        title: "Your Sabotage bounced off Ann's Mirror",
        detail: "5 points lost · Week 01",
      });
      expect(
        byId(feed("ann", at("2026-06-30T19:00:00Z")).items, "defended:7"),
      ).toBeUndefined();
    });
  });

  describe("gifts", () => {
    it("tells the recipient who sent coins, with their note", () => {
      const { items } = feedFor(
        {
          players: [
            { id: "ann", seasonId: "cohort-2026", name: "Ann" },
            { id: "bob", seasonId: "cohort-2026", name: "Bob" },
          ],
          coins: {
            ...competitionData().coins,
            gifts: [
              {
                id: 3,
                fromPlayerId: "bob",
                toPlayerId: "ann",
                amount: 2,
                message: "for the carry",
                at: "2026-06-30T10:00:00.000Z",
              },
            ],
          },
        },
        { playerId: "ann" },
      );
      expect(byId(items, "gift:3")).toEqual({
        id: "gift:3",
        kind: "gift-received",
        title: "Bob sent you 2 Clim Coin",
        detail: '"for the carry"',
        href: "/account#history",
        at: "2026-06-30T10:00:00.000Z",
        unread: true,
      });
    });

    it("tells a player how the Taskmaster answered their wish", () => {
      const wish = {
        purchaseId: 1,
        playerId: "ann",
        wish: "An extra day",
        at: "2026-06-30T09:00:00.000Z",
      };
      const { items } = feedFor(
        {
          coins: {
            ...competitionData().coins,
            wishes: [
              { ...wish, id: 1, status: "pending" },
              {
                ...wish,
                id: 2,
                status: "granted",
                response: "Enjoy!",
                decidedAt: "2026-06-30T10:00:00.000Z",
              },
              {
                ...wish,
                id: 3,
                status: "declined",
                decidedAt: "2026-06-30T11:00:00.000Z",
              },
            ],
          },
        },
        { playerId: "ann" },
      );
      expect(byId(items, "wish:1")).toBeUndefined();
      expect(byId(items, "wish:2")).toEqual({
        id: "wish:2",
        kind: "wish-granted",
        title: "The Taskmaster granted your wish",
        detail: "Enjoy!",
        href: "/account#wish",
        at: "2026-06-30T10:00:00.000Z",
        unread: true,
      });
      expect(byId(items, "wish:3")).toMatchObject({
        kind: "wish-declined",
        detail: '"An extra day"',
      });
    });

    it("tells a player about coins and items an admin gifted them", () => {
      const { items } = feedFor(
        {
          coins: {
            ...competitionData().coins,
            items: [shopItem({ id: "ghost", name: "Ghost" })],
            adjustments: [
              {
                id: 4,
                playerId: "ann",
                amount: 5,
                reason: "Great sportsmanship",
                actorName: "Taskmaster",
                at: "2026-06-30T10:00:00.000Z",
              },
              {
                id: 5,
                playerId: "ann",
                amount: -2,
                reason: "Correction",
                actorName: "Taskmaster",
                at: "2026-06-30T11:00:00.000Z",
              },
            ],
            itemGifts: [
              {
                id: 6,
                purchaseId: 9,
                playerId: "ann",
                itemId: "ghost",
                reason: "Best costume",
                actorName: "Taskmaster",
                at: "2026-06-30T12:00:00.000Z",
              },
            ],
          },
        },
        { playerId: "ann" },
      );
      expect(byId(items, "coin-grant:4")).toEqual({
        id: "coin-grant:4",
        kind: "gift-received",
        title: "You were gifted 5 Clim Coin",
        detail: "Great sportsmanship",
        href: "/account#history",
        at: "2026-06-30T10:00:00.000Z",
        unread: true,
      });
      expect(byId(items, "coin-grant:5")).toBeUndefined();
      expect(byId(items, "item-gift:6")).toEqual({
        id: "item-gift:6",
        kind: "gift-received",
        title: "You were gifted Ghost",
        detail: "Best costume",
        href: "/account#inventory",
        at: "2026-06-30T12:00:00.000Z",
        unread: true,
      });
    });

    it("tells a player about an egg an admin gifted them, while eggs are on", () => {
      const eggGift = {
        id: 8,
        playerId: "ann",
        crateId: "faberge-egg",
        reason: "Star of the week",
        actorName: "Taskmaster",
        at: "2026-06-30T13:00:00.000Z",
      };
      const feed = (shop_eggs: boolean) =>
        feedFor(
          {
            features: {
              ...competitionData().features,
              shop_eggs,
            },
            coins: { ...competitionData().coins, eggGifts: [eggGift] },
          },
          { playerId: "ann" },
        ).items;
      expect(byId(feed(true), "egg-gift:8")).toEqual({
        id: "egg-gift:8",
        kind: "gift-received",
        title: "You were gifted a Fabergé Egg",
        detail: "Star of the week",
        href: "/account#inventory",
        at: "2026-06-30T13:00:00.000Z",
        unread: true,
      });
      expect(byId(feed(false), "egg-gift:8")).toBeUndefined();
    });
  });
});
