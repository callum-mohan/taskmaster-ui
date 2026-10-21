import type {
  CompetitionData,
  NotificationFeed,
  NotificationItem,
  NotificationKind,
  PlayerRankChange,
  PowerUpFeedEntry,
  Task,
} from "../types";
import { withBase } from "../lib/url";
import { ukDateFormat } from "../lib/time";
import { SABOTAGE_POINTS } from "./coin-rules";

const weekLabel = (weekNumber: number) =>
  `Week ${String(weekNumber).padStart(2, "0")}`;

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const closesFmt = ukDateFormat({
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** How long before a live task's deadline the reminder appears. */
const DEADLINE_REMINDER_MS = 24 * 60 * 60 * 1000;

interface FeedOptions {
  /** The player the feed is for; adds their results, rank and bonuses. */
  playerId?: string;
  /** When the player last opened their notifications (ISO 8601). */
  readAt?: string;
  now?: number;
  limit?: number;
}

type FeedEvent = Omit<NotificationItem, "unread"> & { time: number };

interface NotificationDeps {
  getPlayerRankHistory: (playerId: string) => PlayerRankChange[];
  /** Sabotages that hit a player (Clim Coin power-ups). */
  getSabotagesOf?: (playerId: string) => PowerUpFeedEntry[];
}

/**
 * A player's notification feed, derived from the request snapshot (spread
 * into `createQueries`). Nothing is stored per event: tasks appear once
 * released, polls once opened, deadline reminders a day before a live task
 * closes (until it does), and results, rank climbs and bonuses once their
 * scores were recorded (`createdAt`). The only per-player fact is when they
 * last read the feed, which decides what is unread.
 */
export function createNotificationQueries(
  data: CompetitionData,
  { getPlayerRankHistory, getSabotagesOf = () => [] }: NotificationDeps,
) {
  const { tasks, polls, scores, bonusPoints, resultsPostedAt } = data;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Locked tasks are only ever named by their week.
  const taskName = (task: Task) =>
    !task.locked && task.title.length > 0
      ? task.title
      : `${weekLabel(task.weekNumber)} brief`;

  function events(now: number, playerId?: string): FeedEvent[] {
    const released: FeedEvent[] = tasks.flatMap((task) => {
      const time = new Date(task.releaseDate).getTime();
      if (Number.isNaN(time) || time > now) return [];
      const kind: NotificationKind = "task-released";
      return [
        {
          id: `task:${task.id}`,
          kind,
          title: taskName(task),
          detail: [
            weekLabel(task.weekNumber),
            `${task.format} task`,
            ...(task.locked ? ["locked"] : []),
          ].join(" · "),
          href: withBase(`/tasks/${task.id}`),
          at: task.releaseDate,
          time,
        },
      ];
    });

    // Transient: shown from 24h before a live task's deadline until it passes.
    const reminders: FeedEvent[] = tasks.flatMap((task) => {
      if (task.status !== "live") return [];
      const deadline = new Date(task.deadline).getTime();
      const release = new Date(task.releaseDate).getTime();
      const time = Math.max(deadline - DEADLINE_REMINDER_MS, release);
      if (Number.isNaN(time) || time > now || now >= deadline) return [];
      const kind: NotificationKind = "deadline-soon";
      return [
        {
          id: `deadline:${task.id}`,
          kind,
          title: `Deadline in 24h: ${taskName(task)}`,
          detail: `${weekLabel(task.weekNumber)} · closes ${closesFmt.format(deadline)}`,
          href: withBase(`/tasks/${task.id}`),
          at: new Date(time).toISOString(),
          time,
        },
      ];
    });

    const results: FeedEvent[] = tasks.flatMap((task) => {
      const at = resultsPostedAt[task.id];
      const time = at ? new Date(at).getTime() : Number.NaN;
      if (Number.isNaN(time) || time > now) return [];
      const yours = playerId
        ? scores.find((s) => s.taskId === task.id && s.playerId === playerId)
        : undefined;
      const who = task.format === "team" ? "your squad" : "you";
      const outcome = yours
        ? `${who} came ${ordinal(yours.position)} with ${plural(yours.points, "pt")}`
        : playerId
          ? `${who} weren't scored`
          : undefined;
      const kind: NotificationKind = "results-posted";
      return [
        {
          id: `results:${task.id}`,
          kind,
          title: `Results are in for ${weekLabel(task.weekNumber)}`,
          detail: [taskName(task), ...(outcome ? [outcome] : [])].join(" · "),
          href: withBase(`/tasks/${task.id}#results`),
          at,
          time,
        },
      ];
    });

    const climbs: FeedEvent[] = playerId
      ? getPlayerRankHistory(playerId).flatMap(
          ({ task, rank, previousRank, at }) => {
            const time = new Date(at).getTime();
            if (rank >= previousRank || Number.isNaN(time) || time > now)
              return [];
            const kind: NotificationKind = "rank-up";
            return [
              {
                id: `rank:${task.id}`,
                kind,
                title: `You moved up to #${rank}`,
                detail: `${weekLabel(task.weekNumber)} results · up from #${previousRank}`,
                href: withBase("/leaderboard"),
                at,
                time,
              },
            ];
          },
        )
      : [];

    // Poll-vote bonuses are left out: the player earned them by voting just
    // then, and they aren't stored with an id or time.
    const adjustments: FeedEvent[] = playerId
      ? bonusPoints.flatMap((bonus) => {
          if (bonus.playerId !== playerId) return [];
          if (bonus.id === undefined || !bonus.awardedAt) return [];
          const time = new Date(bonus.awardedAt).getTime();
          if (Number.isNaN(time) || time > now) return [];
          const task = taskById.get(bonus.taskId);
          const gained = bonus.points > 0;
          const kind: NotificationKind = gained
            ? "bonus-awarded"
            : "points-deducted";
          return [
            {
              id: `bonus:${bonus.id}`,
              kind,
              title: gained
                ? `You got +${plural(bonus.points, "bonus point")}`
                : `You lost ${plural(-bonus.points, "point")}`,
              detail: [
                bonus.reason,
                ...(task ? [weekLabel(task.weekNumber)] : []),
              ].join(" · "),
              href: withBase(`/players/${playerId}#bonus-heading`),
              at: bonus.awardedAt,
              time,
            },
          ];
        })
      : [];

    const sabotages: FeedEvent[] = playerId
      ? getSabotagesOf(playerId).flatMap((use) => {
          const time = new Date(use.at).getTime();
          if (Number.isNaN(time) || time > now) return [];
          const task = taskById.get(use.taskId);
          const kind: NotificationKind = "sabotaged";
          return [
            {
              id: `sabotage:${use.id}`,
              kind,
              title: `${use.player.name} sabotaged you`,
              detail: [
                `${plural(-SABOTAGE_POINTS, "point")} lost`,
                ...(task ? [weekLabel(task.weekNumber)] : []),
              ].join(" · "),
              href: withBase(
                task ? `/tasks/${task.id}#power-ups` : `/players/${playerId}`,
              ),
              at: use.at,
              time,
            },
          ];
        })
      : [];

    const opened: FeedEvent[] = polls.flatMap((poll) => {
      const time = new Date(poll.opensAt).getTime();
      if (!poll.published || Number.isNaN(time) || time > now) return [];
      const kind: NotificationKind = "poll-opened";
      return [
        {
          id: `poll:${poll.id}`,
          kind,
          title: poll.question,
          detail: poll.status === "open" ? "voting open" : "voting closed",
          href: withBase(`/#poll-${encodeURIComponent(poll.id)}`),
          at: poll.opensAt,
          time,
        },
      ];
    });

    return [
      ...released,
      ...reminders,
      // A climb shares its week's results time; listed first, it sorts
      // above them (the sort is stable).
      ...climbs,
      ...results,
      ...adjustments,
      ...sabotages,
      ...opened,
    ];
  }

  /** The newest `limit` notifications, newest first, flagged read/unread. */
  function getNotifications({
    playerId,
    readAt,
    now = Date.now(),
    limit = 20,
  }: FeedOptions = {}): NotificationFeed {
    const readTime = readAt ? new Date(readAt).getTime() : Number.NaN;
    const items = events(now, playerId)
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map(({ time, ...item }) => ({
        ...item,
        unread: Number.isNaN(readTime) || time > readTime,
      }));
    return {
      items,
      unreadCount: items.filter((item) => item.unread).length,
    };
  }

  return { getNotifications };
}
