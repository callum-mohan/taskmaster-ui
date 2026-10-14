import type { Team } from "../types";
import type {
  teamMembers as teamMembersTable,
  teams as teamsTable,
} from "../db/schema";

type TeamRow = typeof teamsTable.$inferSelect;
type TeamMemberRow = typeof teamMembersTable.$inferSelect;

// The squads for team-format tasks, in team order. `memberIds` (from
// `team_members`, in member order) is the single source of truth for
// membership — resolve members via the player lookup where needed.
export function mapTeams(
  teamRows: TeamRow[],
  memberRows: TeamMemberRow[],
): Team[] {
  return teamRows.map((row) => ({
    id: row.id,
    name: row.name,
    ...(row.tagline !== null && { tagline: row.tagline }),
    memberIds: memberRows
      .filter((member) => member.teamId === row.id)
      .map((member) => member.playerId),
  }));
}
