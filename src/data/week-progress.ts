import { WEEK_STEPS, weekHref } from "../lib/admin-nav";
import type {
  Task,
  WeekCounts,
  WeekProgress,
  WeekStep,
  WeekStepId,
  WeekStepState,
} from "../types";

export const EMPTY_WEEK_COUNTS: WeekCounts = {
  individualScores: 0,
  teamScores: 0,
  bonuses: 0,
  entries: 0,
  hiddenEntries: 0,
  recapWritten: false,
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Where a week stands on each admin step (brief → judge → results night →
 * recap) and which one needs doing next. Pure: everything comes from the
 * task, its counts and the size of the roster it's scored against.
 */
export function getWeekProgress(
  task: Task,
  counts: WeekCounts = EMPTY_WEEK_COUNTS,
  roster: { players: number; teams: number },
): WeekProgress {
  const isTeam = task.format === "team";
  const rosterSize = isTeam ? roster.teams : roster.players;
  const scored = isTeam ? counts.teamScores : counts.individualScores;
  const takesEntries = task.submissions.max > 0;
  const published = scored > 0 && !task.resultsHeld;

  const status: Record<WeekStepId, { state: WeekStepState; detail: string }> = {
    brief:
      task.status === "upcoming"
        ? { state: "optional", detail: "not released yet" }
        : { state: "done", detail: "released" },

    judge:
      task.status === "upcoming"
        ? { state: "waiting", detail: "opens on release" }
        : task.status === "live"
          ? {
              state: "waiting",
              detail: takesEntries
                ? `${plural(counts.entries, "entry", "entries")} so far`
                : "task in progress",
            }
          : {
              state: scored >= rosterSize ? "done" : "active",
              detail:
                scored === 0
                  ? "not scored"
                  : `${scored} / ${rosterSize} scored`,
            },

    live: task.resultsHeld
      ? {
          state: "active",
          detail:
            task.resultsRevealCount > 0
              ? `held · ${task.resultsRevealCount} revealed`
              : "held",
        }
      : published
        ? { state: "done", detail: "published" }
        : { state: "optional", detail: "optional" },

    recap: counts.recapWritten
      ? { state: "done", detail: "written" }
      : published
        ? { state: "optional", detail: "auto copy" }
        : { state: "waiting", detail: "after results" },
  };

  const steps: WeekStep[] = WEEK_STEPS.map(({ id, label }) => ({
    id,
    label,
    href: weekHref(task.id, id),
    ...status[id],
  }));

  return {
    steps,
    next: steps.find((step) => step.state === "active"),
    scored,
    roster: rosterSize,
  };
}
