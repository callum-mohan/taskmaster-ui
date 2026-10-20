import type {
  CompetitionData,
  GalleryEntry,
  PeoplesChoiceSummary,
  PublicGalleryGroup,
  ReactionTally,
  SubmissionGalleryGroup,
  SubmissionReaction,
  SubmissionViewer,
  Task,
} from "../types";
import { REACTIONS, REACTION_KINDS } from "../lib/reactions";
import {
  PEOPLES_CHOICE_BONUS_POINTS,
  derivePeoplesChoiceStatus,
  peoplesChoiceClosesAt,
  peoplesChoiceWinners,
} from "./peoples-choice";

/**
 * Reactions and People's Choice over the public gallery (spread into
 * `createQueries`). Entries and reactions are loaded per task and passed in;
 * the votes come from the snapshot. Every rule about who may react or vote
 * lives here, so the task page and the gallery endpoint can't disagree.
 */
export function createGalleryQueries(data: CompetitionData) {
  const { players, peoplesChoiceVotes } = data;
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const teamOf = new Map(
    data.teams.flatMap((t) => t.memberIds.map((id) => [id, t.id] as const)),
  );

  const votesFor = (taskId: string) =>
    peoplesChoiceVotes.filter((v) => v.taskId === taskId);

  /** Whether an entry belongs to the player (or their squad, for squad entries). */
  function isOwnEntry(
    entry: { playerId: string; teamId?: string },
    playerId: string,
  ): boolean {
    if (entry.teamId) return teamOf.get(playerId) === entry.teamId;
    return entry.playerId === playerId;
  }

  function getPeoplesChoice(
    task: Task,
    viewer: SubmissionViewer,
  ): PeoplesChoiceSummary {
    const status = derivePeoplesChoiceStatus(task);
    const votes = votesFor(task.id);
    const myVote = viewer.playerId
      ? votes.find((v) => v.playerId === viewer.playerId)?.submissionId
      : undefined;
    return {
      status,
      closesAt: peoplesChoiceClosesAt(task),
      bonusPoints: PEOPLES_CHOICE_BONUS_POINTS,
      voterCount: votes.length,
      canVote: status === "open" && viewer.playerId !== undefined,
      ...(myVote !== undefined && { myVote }),
      winners: status === "closed" ? peoplesChoiceWinners(votes) : [],
    };
  }

  /**
   * May this player vote for this entry right now? Open vote, a visible
   * entry on this task, and not their own (or their squad's).
   */
  function canVoteForEntry(
    task: Task,
    entry: {
      taskId: string;
      playerId: string;
      teamId?: string;
      hidden: boolean;
    },
    playerId: string,
  ): boolean {
    return (
      derivePeoplesChoiceStatus(task) === "open" &&
      entry.taskId === task.id &&
      !entry.hidden &&
      !isOwnEntry(entry, playerId)
    );
  }

  /** May this viewer react to entries on the task (players, once the gallery is up)? */
  const canReactOnTask = (task: Task, viewer: SubmissionViewer) =>
    task.status === "completed" && viewer.playerId !== undefined;

  function tallyReactions(
    submissionId: number,
    reactions: SubmissionReaction[],
    playerId: string | undefined,
  ): ReactionTally[] {
    const mine = reactions.filter((r) => r.submissionId === submissionId);
    return REACTION_KINDS.map((kind) => {
      const of = mine.filter((r) => r.kind === kind);
      return {
        kind,
        ...REACTIONS[kind],
        count: of.length,
        mine: playerId !== undefined && of.some((r) => r.playerId === playerId),
        names: of.map((r) => nameOf.get(r.playerId) ?? r.playerId),
      };
    });
  }

  /**
   * The public gallery with each entry's reactions and People's Choice
   * state. Vote counts only show once voting has closed, so nobody piles
   * onto a front-runner.
   */
  function getSocialGallery(
    task: Task,
    groups: SubmissionGalleryGroup[],
    reactions: SubmissionReaction[],
    viewer: SubmissionViewer,
  ): PublicGalleryGroup[] {
    const choice = getPeoplesChoice(task, viewer);
    const votes = votesFor(task.id);
    const canReact = canReactOnTask(task, viewer);
    const winners = new Set(choice.winners);
    return groups.map((group) => ({
      owner: group.owner,
      entries: group.entries.map((entry): GalleryEntry => ({
        ...entry,
        social: {
          reactions: tallyReactions(entry.id, reactions, viewer.playerId),
          canReact,
          canVote:
            choice.canVote &&
            viewer.playerId !== undefined &&
            canVoteForEntry(task, entry, viewer.playerId),
          votedFor: choice.myVote === entry.id,
          ...(choice.status === "closed" && {
            votes: votes.filter(
              (v) => v.submissionId === entry.id && !v.entryHidden,
            ).length,
          }),
          winner: winners.has(entry.id),
        },
      })),
    }));
  }

  return {
    getPeoplesChoice,
    canVoteForEntry,
    canReactOnTask,
    getReactionTallies: tallyReactions,
    getSocialGallery,
  };
}
