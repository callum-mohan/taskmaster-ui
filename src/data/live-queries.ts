import type {
  CompetitionData,
  LiveResultRow,
  LiveRunStep,
  LiveShow,
  Task,
} from "../types";
import { withBase } from "../lib/url";
import { buildScoreRecords, type ScoreRows } from "./scores";

/** A ranked result before it's decided whether it has been revealed. */
type RankedResult = Omit<LiveResultRow, "latest">;

/**
 * Results-night selectors (spread into `createQueries`). The held scores are
 * passed in (see `live.ts`) because the public snapshot leaves them out.
 * Results are revealed bottom first, Taskmaster style: step 1 is last
 * place, the final step is the winner.
 */
export function createLiveQueries(data: CompetitionData) {
  const { players, teams, tasks } = data;
  const playersById = new Map(players.map((p) => [p.id, p]));

  /**
   * The week whose results are being held for a live reveal: one that has
   * started revealing, else the latest held week whose deadline has passed.
   */
  function getLiveTask(): Task | undefined {
    const held = tasks
      .filter((t) => t.resultsHeld && t.status === "completed")
      .sort((a, b) => b.weekNumber - a.weekNumber);
    return held.find((t) => t.resultsRevealCount > 0) ?? held[0];
  }

  /** Every result for the task, best first (ties share a position). */
  function rankResults(
    task: Task,
    rows: Pick<ScoreRows, "taskScores" | "teamScores">,
  ): RankedResult[] {
    const records = buildScoreRecords(
      { ...rows, bonusPoints: [] },
      { players, teams, tasks: [task] },
    );
    if (task.format === "team") {
      return records.teamScores.flatMap((s) => {
        const team = teams.find((t) => t.id === s.teamId);
        if (!team) return [];
        return [
          {
            position: s.position,
            type: "team" as const,
            id: team.id,
            name: team.name,
            href: withBase(`/teams/${team.id}`),
            points: s.points,
            ...(s.comment !== undefined && { comment: s.comment }),
            members: team.memberIds.flatMap((id) => playersById.get(id) ?? []),
          },
        ];
      });
    }
    return records.scores.flatMap((s) => {
      const player = playersById.get(s.playerId);
      if (!player) return [];
      return [
        {
          position: s.position,
          type: "player" as const,
          id: player.id,
          name: player.name,
          href: withBase(`/players/${player.id}`),
          points: s.points,
          ...(s.comment !== undefined && { comment: s.comment }),
          player,
        },
      ];
    });
  }

  /**
   * The public board: only the results revealed so far (the bottom
   * `revealCount`), best first. Everything else is just counted.
   */
  function getLiveShow(
    task: Task,
    rows: Pick<ScoreRows, "taskScores" | "teamScores">,
  ): LiveShow {
    const ranked = rankResults(task, rows);
    const total = ranked.length;
    const count = Math.min(task.resultsRevealCount, total);
    const revealed = ranked
      .slice(total - count)
      .map((row, index) => ({ ...row, latest: index === 0 }));
    const fingerprint = revealed.map((r) => `${r.id}=${r.points}`).join(",");
    return {
      task,
      total,
      revealed,
      hiddenCount: total - count,
      complete: total > 0 && count === total,
      version: `${task.id}:${count}/${total}:${fingerprint}`,
    };
  }

  /** The admin's running order: every result, in the order it goes out. */
  function getLiveRunOrder(
    task: Task,
    rows: Pick<ScoreRows, "taskScores" | "teamScores">,
  ): LiveRunStep[] {
    const ranked = rankResults(task, rows);
    return [...ranked].reverse().map((row, index) => ({
      step: index + 1,
      position: row.position,
      name: row.name,
      points: row.points,
      revealed: index < task.resultsRevealCount,
    }));
  }

  return { getLiveTask, getLiveShow, getLiveRunOrder };
}
