import type {
  CompetitionData,
  MiniTask,
  MiniTaskBoard,
  MiniTaskView,
} from "../types";

/** Mini-task selectors (spread into `createQueries`). */
export function createMiniTaskQueries(data: CompetitionData) {
  const { miniTasks, miniTaskCompletions } = data.coins;
  const completionsOf = new Map<number, number>();
  for (const done of miniTaskCompletions) {
    completionsOf.set(
      done.miniTaskId,
      (completionsOf.get(done.miniTaskId) ?? 0) + 1,
    );
  }

  function viewOf(task: MiniTask, playerId: string | undefined): MiniTaskView {
    const mine = playerId
      ? miniTaskCompletions.find(
          (d) => d.miniTaskId === task.id && d.playerId === playerId,
        )
      : undefined;
    return {
      task,
      completed: mine !== undefined,
      ...(mine && { completedAt: mine.at }),
      completions: completionsOf.get(task.id) ?? 0,
    };
  }

  /**
   * What's running and coming up, with `playerId`'s completions marked (or
   * none, for a signed-out visitor).
   */
  function getMiniTaskBoard(playerId?: string): MiniTaskBoard {
    const active = miniTasks
      .filter((t) => t.status === "active")
      .sort(
        (a, b) =>
          a.endsOn.localeCompare(b.endsOn) || a.title.localeCompare(b.title),
      )
      .map((t) => viewOf(t, playerId));
    const upcoming = miniTasks
      .filter((t) => t.status === "upcoming")
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
      .map((t) => viewOf(t, playerId));
    const rewardOf = new Map(miniTasks.map((t) => [t.id, t.reward]));
    const mine = playerId
      ? miniTaskCompletions.filter((d) => d.playerId === playerId)
      : [];
    return {
      active,
      upcoming,
      completedCount: mine.length,
      coinsEarned: mine.reduce(
        (sum, d) => sum + (rewardOf.get(d.miniTaskId) ?? 0),
        0,
      ),
    };
  }

  /** How many mini-tasks a player has completed this season. */
  function getMiniTaskCount(playerId: string): number {
    return miniTaskCompletions.filter((d) => d.playerId === playerId).length;
  }

  return { getMiniTaskBoard, getMiniTaskCount };
}
