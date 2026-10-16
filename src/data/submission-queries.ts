import type {
  CompetitionData,
  SubmissionEntry,
  SubmissionGalleryGroup,
  SubmissionOwner,
  SubmissionOwnerRef,
  SubmissionPanel,
  SubmissionViewer,
  SubmitterOption,
  SubmitterOptionGroup,
  Task,
  TaskSubmission,
} from "../types";
import { withBase } from "../lib/url";

const sameOwner = (a: SubmissionOwnerRef, b: SubmissionOwnerRef) =>
  a.type === b.type && a.id === b.id;

/** The player or squad whose slots an entry uses. */
export const ownerOf = (submission: TaskSubmission): SubmissionOwnerRef =>
  submission.teamId
    ? { type: "team", id: submission.teamId }
    : { type: "player", id: submission.playerId };

/** The access-checked image link for a photo entry. */
export const submissionMediaUrl = (id: number) =>
  withBase(`/submissions/${id}/media`);

/**
 * Submission selectors over the request snapshot (spread into
 * `createQueries`). Entries themselves are loaded per task
 * (`loadTaskSubmissions`) and passed in. Every rule about who may submit,
 * withdraw or see an entry lives here, so the task page, the media route and
 * the submission endpoint can't disagree.
 */
export function createSubmissionQueries(data: CompetitionData) {
  const { players, teams } = data;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  // The snapshot arrays are already in roster order.
  const rosterIndex = new Map<string, number>([
    ...teams.map((t, i) => [`team:${t.id}`, i] as const),
    ...players.map((p, i) => [`player:${p.id}`, teams.length + i] as const),
  ]);
  const teamByPlayerId = new Map(
    teams.flatMap((team) => team.memberIds.map((id) => [id, team] as const)),
  );

  /**
   * Whose slots a player submits into: their own on individual tasks, their
   * squad's on team tasks (undefined if they aren't in one).
   */
  function getSubmissionOwnerRef(
    task: Task,
    playerId: string,
  ): SubmissionOwnerRef | undefined {
    if (task.format === "individual") return { type: "player", id: playerId };
    const team = teamByPlayerId.get(playerId);
    return team && { type: "team", id: team.id };
  }

  function describeOwner(ref: SubmissionOwnerRef): SubmissionOwner {
    if (ref.type === "team") {
      return {
        type: "team",
        id: ref.id,
        name: teamsById.get(ref.id)?.name ?? ref.id,
        href: withBase(`/teams/${ref.id}`),
      };
    }
    return {
      type: "player",
      id: ref.id,
      name: playersById.get(ref.id)?.name ?? ref.id,
      href: withBase(`/players/${ref.id}`),
    };
  }

  const toEntry = (submission: TaskSubmission): SubmissionEntry => ({
    ...submission,
    submitterName:
      playersById.get(submission.playerId)?.name ?? submission.playerId,
    ...(submission.kind === "photo" && {
      mediaUrl: submissionMediaUrl(submission.id),
    }),
  });

  /**
   * Who may see an entry: admins always; everyone once the deadline has
   * passed (unless an admin hid it); before that only the player or squad
   * it belongs to.
   */
  function canViewSubmission(
    task: Task,
    submission: TaskSubmission,
    viewer: SubmissionViewer,
  ): boolean {
    if (viewer.isAdmin) return true;
    if (task.status === "completed" && !submission.hidden) return true;
    if (!viewer.playerId) return false;
    const owner = getSubmissionOwnerRef(task, viewer.playerId);
    return owner !== undefined && sameOwner(owner, ownerOf(submission));
  }

  /** The viewer's entries and whether they can add another. */
  function getSubmissionPanel(
    task: Task,
    submissions: TaskSubmission[],
    viewer: SubmissionViewer,
  ): SubmissionPanel {
    const settings = task.submissions;
    const panel: SubmissionPanel = {
      settings,
      entries: [],
      remaining: 0,
      canSubmit: false,
      canDelete: false,
    };
    if (task.status === "upcoming") return { ...panel, blockedBy: "upcoming" };
    if (task.status === "completed") {
      return { ...panel, blockedBy: "completed" };
    }
    if (settings.max === 0) return { ...panel, blockedBy: "closed" };
    if (task.locked) return { ...panel, blockedBy: "encrypted" };
    if (!viewer.signedIn) return { ...panel, blockedBy: "guest" };
    if (!viewer.playerId) return { ...panel, blockedBy: "no-player" };
    const ref = getSubmissionOwnerRef(task, viewer.playerId);
    if (!ref) return { ...panel, blockedBy: "no-team" };

    const entries = submissions
      .filter((s) => sameOwner(ownerOf(s), ref))
      .map(toEntry);
    const remaining = Math.max(0, settings.max - entries.length);
    return {
      ...panel,
      owner: describeOwner(ref),
      entries,
      remaining,
      canSubmit: remaining > 0,
      canDelete: true,
      ...(remaining === 0 && { blockedBy: "full" as const }),
    };
  }

  /**
   * Entries grouped by player or squad, in roster order. `includeEmpty`
   * adds everyone who could have entered (the admin gallery scores them
   * all); `includeHidden` keeps entries an admin hid.
   */
  function getSubmissionGallery(
    task: Task,
    submissions: TaskSubmission[],
    { includeEmpty = false, includeHidden = false } = {},
  ): SubmissionGalleryGroup[] {
    const groups = new Map<string, SubmissionGalleryGroup>();
    const key = (ref: SubmissionOwnerRef) => `${ref.type}:${ref.id}`;
    const ensure = (ref: SubmissionOwnerRef) => {
      let group = groups.get(key(ref));
      if (!group) {
        group = { owner: describeOwner(ref), entries: [] };
        groups.set(key(ref), group);
      }
      return group;
    };
    if (includeEmpty) {
      const roster: SubmissionOwnerRef[] =
        task.format === "team"
          ? teams.map((t) => ({ type: "team", id: t.id }))
          : players.map((p) => ({ type: "player", id: p.id }));
      roster.forEach(ensure);
    }
    for (const submission of submissions) {
      if (submission.hidden && !includeHidden) continue;
      ensure(ownerOf(submission)).entries.push(toEntry(submission));
    }
    // Squads before players (only mixed if a task changed format), each in
    // roster order.
    const order = (owner: SubmissionOwner) =>
      rosterIndex.get(`${owner.type}:${owner.id}`) ?? Infinity;
    return [...groups.values()]
      .filter((g) => includeEmpty || g.entries.length > 0)
      .sort((a, b) => order(a.owner) - order(b.owner));
  }

  /** The public gallery: visible entries once the deadline has passed. */
  function getPublicSubmissionGallery(
    task: Task,
    submissions: TaskSubmission[],
  ): SubmissionGalleryGroup[] {
    return task.status === "completed"
      ? getSubmissionGallery(task, submissions)
      : [];
  }

  /**
   * Admins add entries on a player's behalf (e.g. sent in by message) once
   * the deadline has passed, regardless of the task's entry limit or kinds.
   */
  const canAddEntriesForPlayers = (task: Task) => task.status === "completed";

  /**
   * Who an admin can add an entry for: every player on individual tasks;
   * squad members (grouped by squad) on team tasks, as the entry goes to the
   * squad.
   */
  function getSubmitterOptions(task: Task): SubmitterOptionGroup[] {
    const option = (id: string): SubmitterOption => ({
      id,
      name: playersById.get(id)?.name ?? id,
    });
    if (task.format === "individual") {
      return [{ players: players.map((p) => option(p.id)) }];
    }
    return teams
      .filter((team) => team.memberIds.length > 0)
      .map((team) => ({
        label: team.name,
        players: team.memberIds.map(option),
      }));
  }

  return {
    getSubmissionOwnerRef,
    canViewSubmission,
    getSubmissionPanel,
    getSubmissionGallery,
    getPublicSubmissionGallery,
    canAddEntriesForPlayers,
    getSubmitterOptions,
  };
}
