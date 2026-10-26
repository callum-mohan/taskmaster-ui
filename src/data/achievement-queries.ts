import type {
  Achievement,
  AchievementBoard,
  AchievementCategory,
  AchievementProgress,
  CompetitionData,
  LeaderboardRow,
  PlayerTaskResult,
  Wallet,
} from "../types";
import { isWinningPick } from "./predictions";

// The achievements catalogue on `/account/achievements`: long-term goals a
// player works towards over a season, each with progress so far. Derived
// entirely from the season's records, like the profile badges.

interface AchievementDeps {
  getLeaderboardWithMovement(): LeaderboardRow[];
  getPlayerResults(playerId: string): PlayerTaskResult[];
  getWallet(playerId: string): Wallet;
  getMiniTaskCount(playerId: string): number;
}

/** What one achievement needs, worked out from a player's season. */
interface PlayerFacts {
  scored: number;
  wins: number;
  podiums: number;
  points: number;
  rank?: number;
  averagePosition: number;
  longestWinRun: number;
  longestPodiumRun: number;
  completedWeeks: number;
  topSingleScore: boolean;
  entries: number;
  calls: number;
  correctCalls: number;
  pollVotes: number;
  peoplesChoiceVotes: number;
  miniTasks: number;
  coinsEarned: number;
  itemsBought: number;
  playersGifted: number;
}

interface AchievementDefinition extends Omit<Achievement, "detail" | "accent"> {
  category: AchievementCategory;
  /** The goal, e.g. "Win 3 tasks". */
  goal: string;
  target: (facts: PlayerFacts) => number;
  current: (facts: PlayerFacts) => number;
}

const CATEGORIES: {
  category: AchievementCategory;
  label: string;
  command: string;
  accent: Achievement["accent"];
}[] = [
  {
    category: "results",
    label: "Results",
    command: "grep --results",
    accent: "acid",
  },
  {
    category: "streaks",
    label: "Streaks & form",
    command: "grep --streaks",
    accent: "magenta",
  },
  {
    category: "taking-part",
    label: "Taking part",
    command: "grep --taking-part",
    accent: "cyan",
  },
  {
    category: "coin",
    label: "Clim Coin",
    command: "grep --coin",
    accent: "amber",
  },
];

const once = () => 1;
const flag = (value: boolean) => (value ? 1 : 0);

/** Every achievement, in display order within its category. */
export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "off-the-mark",
    category: "results",
    label: "Off the Mark",
    goal: "Get scored on a task",
    icon: "🎬",
    target: once,
    current: (f) => f.scored,
  },
  {
    id: "task-winner",
    category: "results",
    label: "Task Winner",
    goal: "Win a task",
    icon: "🥇",
    target: once,
    current: (f) => f.wins,
  },
  {
    id: "serial-winner",
    category: "results",
    label: "Serial Winner",
    goal: "Win 3 tasks",
    icon: "🏆",
    target: () => 3,
    current: (f) => f.wins,
  },
  {
    id: "podium-collector",
    category: "results",
    label: "Podium Collector",
    goal: "Finish top 3 on 5 tasks",
    icon: "🎖️",
    target: () => 5,
    current: (f) => f.podiums,
  },
  {
    id: "century",
    category: "results",
    label: "Century",
    goal: "Reach 100 points in the season",
    icon: "💯",
    target: () => 100,
    current: (f) => f.points,
  },
  {
    id: "high-scorer",
    category: "results",
    label: "High Scorer",
    goal: "Hold the season's top single-task score",
    icon: "⚡",
    target: once,
    current: (f) => flag(f.topSingleScore),
  },
  {
    id: "top-of-the-table",
    category: "results",
    label: "Top of the Table",
    goal: "Be #1 on the leaderboard",
    icon: "👑",
    target: once,
    current: (f) => flag(f.rank === 1),
  },
  {
    id: "on-fire",
    category: "streaks",
    label: "On Fire",
    goal: "Win 2 tasks in a row",
    icon: "🔥",
    target: () => 2,
    current: (f) => f.longestWinRun,
  },
  {
    id: "podium-regular",
    category: "streaks",
    label: "Podium Regular",
    goal: "Finish top 3 on 3 tasks in a row",
    icon: "📶",
    target: () => 3,
    current: (f) => f.longestPodiumRun,
  },
  {
    id: "ever-present",
    category: "streaks",
    label: "Ever Present",
    goal: "Get scored on every finished task",
    icon: "📅",
    target: (f) => Math.max(1, f.completedWeeks),
    current: (f) => (f.completedWeeks === 0 ? 0 : f.scored),
  },
  {
    id: "ever-reliable",
    category: "streaks",
    label: "Ever Reliable",
    goal: "Average top-3 finishes over 4+ tasks",
    icon: "🎯",
    target: () => 4,
    // Counts up to 4 scored tasks, but only while the average is top 3.
    current: (f) => (f.scored > 0 && f.averagePosition <= 3 ? f.scored : 0),
  },
  {
    id: "show-up",
    category: "taking-part",
    label: "Show Up",
    goal: "Submit entries on 5 tasks",
    icon: "📸",
    target: () => 5,
    current: (f) => f.entries,
  },
  {
    id: "pundit",
    category: "taking-part",
    label: "Pundit",
    goal: "Call the winner on 5 tasks",
    icon: "🗣️",
    target: () => 5,
    current: (f) => f.calls,
  },
  {
    id: "oracle",
    category: "taking-part",
    label: "Oracle",
    goal: "Call 3 winners correctly",
    icon: "🔮",
    target: () => 3,
    current: (f) => f.correctCalls,
  },
  {
    id: "voice-of-the-people",
    category: "taking-part",
    label: "Voice of the People",
    goal: "Vote in 5 polls",
    icon: "🗳️",
    target: () => 5,
    current: (f) => f.pollVotes,
  },
  {
    id: "art-critic",
    category: "taking-part",
    label: "Art Critic",
    goal: "Cast 5 People's Choice votes",
    icon: "🖼️",
    target: () => 5,
    current: (f) => f.peoplesChoiceVotes,
  },
  {
    id: "side-quester",
    category: "taking-part",
    label: "Side Quester",
    goal: "Complete 5 mini-tasks",
    icon: "🧩",
    target: () => 5,
    current: (f) => f.miniTasks,
  },
  {
    id: "coin-collector",
    category: "coin",
    label: "Coin Collector",
    goal: "Earn 100 Clim Coin",
    icon: "🪙",
    target: () => 100,
    current: (f) => f.coinsEarned,
  },
  {
    id: "retail-therapy",
    category: "coin",
    label: "Retail Therapy",
    goal: "Buy 3 items from the shop",
    icon: "🛍️",
    target: () => 3,
    current: (f) => f.itemsBought,
  },
  {
    id: "generous-soul",
    category: "coin",
    label: "Generous Soul",
    goal: "Gift Clim Coin to 3 different players",
    icon: "🎁",
    target: () => 3,
    current: (f) => f.playersGifted,
  },
];

/** The longest run of consecutive results matching `pred`. */
function longestRun(
  positions: readonly number[],
  pred: (position: number) => boolean,
): number {
  let best = 0;
  let current = 0;
  for (const position of positions) {
    current = pred(position) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

/** Achievement selectors (spread into `createQueries`). */
export function createAchievementQueries(
  data: CompetitionData,
  deps: AchievementDeps,
) {
  const accentOf = new Map(CATEGORIES.map((c) => [c.category, c.accent]));

  function playerFacts(playerId: string): PlayerFacts {
    const standing = deps
      .getLeaderboardWithMovement()
      .find((row) => row.player.id === playerId);
    const positions = deps.getPlayerResults(playerId).map((r) => r.position);
    const topScore = data.scores.reduce<
      (typeof data.scores)[number] | undefined
    >(
      (top, s) => (top === undefined || s.points > top.points ? s : top),
      undefined,
    );
    const myCalls = data.predictions.filter((p) => p.playerId === playerId);
    const purchasedFree = new Set([
      ...data.coins.crateOpens.map((o) => o.purchaseId),
      ...data.coins.itemGifts.map((g) => g.purchaseId),
      ...data.coins.skillUnlocks.flatMap((u) => u.purchaseId ?? []),
    ]);
    return {
      scored: positions.length,
      wins: positions.filter((p) => p === 1).length,
      podiums: positions.filter((p) => p <= 3).length,
      points: Math.max(0, standing?.points ?? 0),
      ...(standing && standing.tasksCompleted > 0 && { rank: standing.rank }),
      averagePosition: standing?.averagePosition ?? 0,
      longestWinRun: longestRun(positions, (p) => p === 1),
      longestPodiumRun: longestRun(positions, (p) => p <= 3),
      completedWeeks: data.tasks.filter(
        (t) => t.status === "completed" && t.id in data.resultsPostedAt,
      ).length,
      topSingleScore: topScore !== undefined && topScore.playerId === playerId,
      entries: new Set(
        data.coins.entries
          .filter((e) => e.playerId === playerId)
          .map((e) => e.taskId),
      ).size,
      calls: myCalls.length,
      correctCalls: myCalls.filter(
        (call) =>
          call.taskId in data.resultsPostedAt &&
          isWinningPick(call, data.scores, data.teamScores),
      ).length,
      pollVotes: data.polls.filter(
        (poll) =>
          poll.published && poll.votes.some((v) => v.playerId === playerId),
      ).length,
      peoplesChoiceVotes: data.peoplesChoiceVotes.filter(
        (v) => v.playerId === playerId && !v.entryHidden,
      ).length,
      miniTasks: deps.getMiniTaskCount(playerId),
      coinsEarned: deps.getWallet(playerId).earned,
      itemsBought: data.coins.purchases.filter(
        (p) =>
          p.playerId === playerId && p.price > 0 && !purchasedFree.has(p.id),
      ).length,
      playersGifted: new Set(
        data.coins.gifts
          .filter((g) => g.fromPlayerId === playerId)
          .map((g) => g.toPlayerId),
      ).size,
    };
  }

  /** Every achievement with `playerId`'s progress, grouped by category. */
  function getAchievementBoard(playerId: string): AchievementBoard {
    const facts = playerFacts(playerId);
    const items: AchievementProgress[] = ACHIEVEMENTS.map((def) => {
      const target = def.target(facts);
      const current = Math.min(target, Math.max(0, def.current(facts)));
      return {
        achievement: {
          id: def.id,
          label: def.label,
          detail: def.goal,
          icon: def.icon,
          accent: accentOf.get(def.category) ?? "acid",
        },
        category: def.category,
        current,
        target,
        unlocked: current >= target,
        percent: Math.round((current / target) * 100),
      };
    });
    return {
      unlockedCount: items.filter((i) => i.unlocked).length,
      total: items.length,
      groups: CATEGORIES.map(({ category, label, command }) => ({
        category,
        label,
        command,
        items: items.filter((i) => i.category === category),
      })),
    };
  }

  return { getAchievementBoard };
}
