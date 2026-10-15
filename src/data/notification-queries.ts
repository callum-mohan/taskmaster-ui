import type {
  CompetitionData,
  NotificationFeed,
  NotificationItem,
  NotificationKind,
} from "../types";
import { withBase } from "../lib/url";

const weekLabel = (weekNumber: number) =>
  `Week ${String(weekNumber).padStart(2, "0")}`;

interface FeedOptions {
  /** When the player last opened their notifications (ISO 8601). */
  readAt?: string;
  now?: number;
  limit?: number;
}

type FeedEvent = Omit<NotificationItem, "unread"> & { time: number };

/**
 * A player's notification feed, derived from the request snapshot (spread
 * into `createQueries`). Nothing is stored per event: tasks appear once
 * released and polls once opened, and the only per-player fact is when they
 * last read the feed, which decides what is unread.
 */
export function createNotificationQueries(data: CompetitionData) {
  const { tasks, polls } = data;

  function events(now: number): FeedEvent[] {
    const released: FeedEvent[] = tasks.flatMap((task) => {
      const time = new Date(task.releaseDate).getTime();
      if (Number.isNaN(time) || time > now) return [];
      const named = !task.locked && task.title.length > 0;
      const kind: NotificationKind = "task-released";
      return [
        {
          id: `task:${task.id}`,
          kind,
          title: named ? task.title : `${weekLabel(task.weekNumber)} brief`,
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

    return [...released, ...opened];
  }

  /** The newest `limit` notifications, newest first, flagged read/unread. */
  function getNotifications({
    readAt,
    now = Date.now(),
    limit = 20,
  }: FeedOptions = {}): NotificationFeed {
    const readTime = readAt ? new Date(readAt).getTime() : Number.NaN;
    const items = events(now)
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
