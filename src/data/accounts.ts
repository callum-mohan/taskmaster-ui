import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { playerAccounts, players } from "../db/schema";
import type {
  AdminUser,
  PlayerAccount,
  PlayerAccountStatus,
  SessionPlayer,
} from "../types";
import type { ProfileInput } from "../lib/account-forms";

// Player sign-in accounts. Neon Auth owns the credentials; this table links
// an auth user to exactly one player. Accounts themselves are created by
// `scripts/create-player-accounts.mjs`, since sign-up is disabled.

type AccountRow = typeof playerAccounts.$inferSelect;

const toAccount = (row: AccountRow): PlayerAccount => ({
  playerId: row.playerId,
  email: row.email,
  ...(row.userId && { userId: row.userId }),
  mustChangePassword: row.mustChangePassword,
});

export function accountStatus(account?: PlayerAccount): PlayerAccountStatus {
  if (!account) return "none";
  if (!account.userId) return "invited";
  return account.mustChangePassword ? "pending" : "active";
}

/** The player linked to a signed-in Neon Auth user, if any. */
export async function getSessionPlayer(
  user: AdminUser,
): Promise<SessionPlayer | undefined> {
  const [row] = await getDb()
    .select({
      playerId: players.id,
      playerName: players.name,
      bio: players.bio,
      avatarUrl: players.avatarUrl,
      mustChangePassword: playerAccounts.mustChangePassword,
    })
    .from(playerAccounts)
    .innerJoin(players, eq(players.id, playerAccounts.playerId))
    .where(eq(playerAccounts.userId, user.id));
  if (!row) return undefined;
  return {
    userId: user.id,
    email: user.email,
    playerId: row.playerId,
    playerName: row.playerName,
    ...(row.bio && { bio: row.bio }),
    ...(row.avatarUrl && { avatarUrl: row.avatarUrl }),
    mustChangePassword: row.mustChangePassword,
    isAdmin: user.isAdmin,
  };
}

// ── Admin ─────────────────────────────────────────────────────────────

export async function getPlayerAccount(
  playerId: string,
): Promise<PlayerAccount | undefined> {
  const [row] = await getDb()
    .select()
    .from(playerAccounts)
    .where(eq(playerAccounts.playerId, playerId));
  return row && toAccount(row);
}

/** Account status for every player, keyed by player id. */
export async function getAccountStatuses(): Promise<
  Record<string, PlayerAccountStatus>
> {
  const rows = await getDb().select().from(playerAccounts);
  return Object.fromEntries(
    rows.map((row) => [row.playerId, accountStatus(toAccount(row))]),
  );
}

/**
 * Sets (or with `null`, withdraws) the invite email for a player who has no
 * account yet. Once the account exists its email belongs to Neon Auth, so
 * it can only change through the provisioning script's `--reset`.
 * Returns `false` when the account already exists.
 */
export async function setPlayerEmail(
  playerId: string,
  email: string | null,
): Promise<boolean> {
  const db = getDb();
  const unlinked = and(
    eq(playerAccounts.playerId, playerId),
    isNull(playerAccounts.userId),
  );
  if (email === null) {
    const existing = await getPlayerAccount(playerId);
    if (existing?.userId) return false;
    await db.delete(playerAccounts).where(unlinked);
    return true;
  }
  const rows = await db
    .insert(playerAccounts)
    .values({ playerId, email })
    .onConflictDoUpdate({
      target: playerAccounts.playerId,
      set: { email },
      setWhere: isNull(playerAccounts.userId),
    })
    .returning({ playerId: playerAccounts.playerId });
  return rows.length > 0;
}

// ── Self-service ──────────────────────────────────────────────────────

/** A player editing their own public profile (bio and avatar only). */
export async function updateOwnProfile(
  playerId: string,
  input: ProfileInput,
): Promise<void> {
  await getDb()
    .update(players)
    .set({ bio: input.bio, avatarUrl: input.avatarUrl })
    .where(eq(players.id, playerId));
}

export async function clearMustChangePassword(userId: string): Promise<void> {
  await getDb()
    .update(playerAccounts)
    .set({ mustChangePassword: false })
    .where(eq(playerAccounts.userId, userId));
}
