import type {
  CompetitionData,
  PredictionChoice,
  PredictionPanel,
  PredictionPick,
  PredictionStatus,
  Task,
} from "../types";
import { withBase } from "../lib/url";
import { PREDICTION_BONUS_POINTS, isWinningPick } from "./predictions";

/** Who is looking at a task's predictions. */
export interface PredictionViewer {
  signedIn: boolean;
  playerId?: string;
}

/**
 * "Call the winner" selectors (spread into `createQueries`). Calls stay
 * secret while the task is live (only a count shows) and are revealed at the
 * deadline, so nobody can copy the crowd.
 */
export function createPredictionQueries(data: CompetitionData) {
  const { players, teams, predictions, scores, teamScores } = data;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const teamOf = new Map(
    teams.flatMap((t) => t.memberIds.map((id) => [id, t.id] as const)),
  );

  function describePick(pick: PredictionPick): PredictionChoice {
    return pick.type === "team"
      ? {
          type: "team",
          id: pick.id,
          name: teamsById.get(pick.id)?.name ?? pick.id,
          href: withBase(`/teams/${pick.id}`),
        }
      : {
          type: "player",
          id: pick.id,
          name: playersById.get(pick.id)?.name ?? pick.id,
          href: withBase(`/players/${pick.id}`),
        };
  }

  const hasResults = (task: Task) =>
    task.format === "team"
      ? teamScores.some((s) => s.taskId === task.id)
      : scores.some((s) => s.taskId === task.id);

  function getPredictionStatus(task: Task): PredictionStatus {
    if (task.status === "upcoming") return "upcoming";
    if (task.status === "live") return "open";
    return hasResults(task) ? "settled" : "locked";
  }

  /** Who a player may back: anyone but themselves or their own squad. */
  function getPredictionOptions(
    task: Task,
    playerId: string,
  ): PredictionChoice[] {
    if (task.format === "team") {
      const own = teamOf.get(playerId);
      return teams
        .filter((t) => t.id !== own && t.memberIds.length > 0)
        .map((t) => describePick({ type: "team", id: t.id }));
    }
    return players
      .filter((p) => p.id !== playerId)
      .map((p) => describePick({ type: "player", id: p.id }));
  }

  /** Whether a player may make this call on the task right now. */
  function canPredict(
    task: Task,
    playerId: string,
    pick: PredictionPick,
  ): boolean {
    if (getPredictionStatus(task) !== "open") return false;
    const expected = task.format === "team" ? "team" : "player";
    if (pick.type !== expected) return false;
    return getPredictionOptions(task, playerId).some((o) => o.id === pick.id);
  }

  function getPredictionPanel(
    task: Task,
    viewer: PredictionViewer,
  ): PredictionPanel {
    const status = getPredictionStatus(task);
    const calls = predictions.filter((p) => p.taskId === task.id);
    const mine = viewer.playerId
      ? calls.find((p) => p.playerId === viewer.playerId)
      : undefined;
    const settled = status === "settled";
    const revealed = status === "locked" || settled;

    const tally = new Map<string, PredictionPanel["tally"][number]>();
    if (revealed) {
      for (const call of calls) {
        const key = `${call.pick.type}:${call.pick.id}`;
        let row = tally.get(key);
        if (!row) {
          row = {
            choice: describePick(call.pick),
            backers: [],
            ...(settled && {
              correct: isWinningPick(call, scores, teamScores),
            }),
          };
          tally.set(key, row);
        }
        const backer = playersById.get(call.playerId);
        if (backer) row.backers.push(backer);
      }
    }

    return {
      status,
      bonusPoints: PREDICTION_BONUS_POINTS,
      viewer: viewer.playerId
        ? "player"
        : viewer.signedIn
          ? "non-player"
          : "guest",
      canPredict: status === "open" && viewer.playerId !== undefined,
      options:
        status === "open" && viewer.playerId
          ? getPredictionOptions(task, viewer.playerId)
          : [],
      ...(mine && { myPick: describePick(mine.pick) }),
      ...(mine &&
        settled && { myPickCorrect: isWinningPick(mine, scores, teamScores) }),
      count: calls.length,
      // The winning pick first, then most-backed, then by name.
      tally: [...tally.values()].sort(
        (a, b) =>
          Number(b.correct ?? false) - Number(a.correct ?? false) ||
          b.backers.length - a.backers.length ||
          a.choice.name.localeCompare(b.choice.name),
      ),
    };
  }

  return { getPredictionPanel, canPredict };
}
