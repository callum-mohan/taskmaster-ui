import type {
  CompetitionData,
  Poll,
  PollCard,
  PollResults,
  PollSettings,
  PollSummary,
  PollViewer,
} from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A poll without its raw votes, so ballots never reach a component. */
const toSettings = ({ votes: _votes, ...settings }: Poll): PollSettings =>
  settings;

/** Distinct players who voted on a poll. */
const voterIds = (poll: Poll) => new Set(poll.votes.map((v) => v.playerId));

/**
 * Poll selectors over the request snapshot (spread into `createQueries`).
 * Every rule about who may vote or see what lives here, so the homepage,
 * the admin pages and the vote endpoint can't disagree.
 */
export function createPollQueries(data: CompetitionData) {
  const { polls, players } = data;
  const playersById = new Map(players.map((p) => [p.id, p]));

  const getPollById = (id: string) => polls.find((p) => p.id === id);

  /**
   * Tallies for a poll. Voter names are only attached to public polls, and
   * only when `withVoters` is set.
   */
  function getPollResults(poll: Poll, withVoters = false): PollResults {
    const voters = voterIds(poll);
    const counts = poll.options.map(
      (option) => poll.votes.filter((v) => v.optionId === option.id).length,
    );
    const top = Math.max(0, ...counts);
    const named = withVoters && !poll.anonymous;
    return {
      voterCount: voters.size,
      eligibleCount: players.length,
      options: poll.options.map((option, i) => ({
        option,
        votes: counts[i],
        percent:
          voters.size === 0 ? 0 : Math.round((counts[i] / voters.size) * 100),
        leading: top > 0 && counts[i] === top,
        ...(named && {
          voters: poll.votes
            .filter((v) => v.optionId === option.id)
            .flatMap((v) => playersById.get(v.playerId) ?? []),
        }),
      })),
    };
  }

  /** Whether a (non-admin) viewer may see the tallies right now. */
  function resultsVisible(poll: Poll, hasVoted: boolean): boolean {
    const closed = poll.status === "closed";
    switch (poll.resultsVisibility) {
      case "always":
        return true;
      case "after_vote":
        return hasVoted || closed;
      case "after_close":
        return closed;
      case "admin_only":
        return false;
    }
  }

  function resultsHint(poll: Poll, viewer: PollViewer): string | undefined {
    if (poll.resultsVisibility === "admin_only") {
      return "Results are private to the Taskmaster.";
    }
    if (poll.resultsVisibility === "after_vote" && viewer.kind === "player") {
      return "Results appear once you vote.";
    }
    return "Results appear when the poll closes.";
  }

  /** Builds the card a given viewer sees for one poll. */
  function getPollCard(poll: Poll, viewer: PollViewer): PollCard {
    const myChoices =
      viewer.kind === "player"
        ? poll.votes
            .filter((v) => v.playerId === viewer.playerId)
            .map((v) => v.optionId)
        : [];
    const hasVoted = myChoices.length > 0;
    const canVote =
      viewer.kind === "player" &&
      poll.status === "open" &&
      (!hasVoted || poll.allowVoteChange);
    const showResults = resultsVisible(poll, hasVoted);
    return {
      poll: toSettings(poll),
      viewer: viewer.kind,
      myChoices,
      hasVoted,
      canVote,
      ...(showResults
        ? { results: getPollResults(poll, true) }
        : { resultsHint: resultsHint(poll, viewer) }),
    };
  }

  /**
   * Polls for the homepage: published polls that have opened, plus closed
   * ones still inside their `showOnHomeDays` window. Open polls come first
   * (newest opening first), then closed ones (most recently closed first).
   */
  function getHomePolls(
    viewer: PollViewer,
    now: number = Date.now(),
  ): PollCard[] {
    const visible = polls.filter((poll) => {
      if (!poll.published || poll.status === "scheduled") return false;
      if (poll.status === "open") return true;
      const closedFor = now - new Date(poll.closesAt).getTime();
      return closedFor < poll.showOnHomeDays * DAY_MS;
    });
    const open = visible.filter((p) => p.status === "open");
    const closed = visible
      .filter((p) => p.status === "closed")
      .sort((a, b) => b.closesAt.localeCompare(a.closesAt));
    return [...open, ...closed].map((poll) => getPollCard(poll, viewer));
  }

  /** Every poll for the admin list (drafts included), newest first. */
  const getPollSummaries = (): PollSummary[] =>
    polls.map((poll) => ({
      poll: toSettings(poll),
      voterCount: voterIds(poll).size,
    }));

  /** Polls whose voting bonus counts in a task week, with voter counts. */
  const getPollBonusesForTask = (taskId: string): PollSummary[] =>
    polls
      .filter((p) => p.bonusTaskId === taskId && p.voteBonusPoints > 0)
      .map((poll) => ({
        poll: toSettings(poll),
        voterCount: voterIds(poll).size,
      }));

  return {
    getPollById,
    getPollBonusesForTask,
    getPollResults,
    getPollCard,
    getHomePolls,
    getPollSummaries,
  };
}
