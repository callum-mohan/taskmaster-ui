import type { Task } from "../types";

/**
 * Why a season can't be closed yet, one reason per unfinished week (empty
 * when it can). Closing crowns the champion from the final standings, so
 * every week must be over with its results in and published.
 */
export function getSeasonCloseBlockers(
  tasks: readonly Task[],
  resultsPostedAt: Readonly<Record<string, string>>,
): string[] {
  if (tasks.length === 0) return ["The season has no weeks yet."];
  return [...tasks]
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .flatMap((task) => {
      const week = `Week ${task.weekNumber}`;
      if (task.status !== "completed") return [`${week} hasn't finished yet.`];
      if (!resultsPostedAt[task.id]) return [`${week} has no results yet.`];
      if (task.resultsHeld) {
        return [`${week}'s results are still held for results night.`];
      }
      return [];
    });
}
