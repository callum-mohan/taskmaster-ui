// Creates sign-in accounts for players on a Neon branch.
//
// An admin first sets each player's email in /admin (stored in
// `player_accounts`). This script then creates a Neon Auth user for every
// invited player that has no account yet, with a random temporary password,
// and links it to the player. Players must change the password on first
// sign-in. Public sign-up is disabled on Neon Auth, so — like
// `admin:create` — it briefly re-enables sign-up and always disables it again.
//
// Usage:
//   npm run players:accounts                     # every invited player
//   npm run players:accounts -- --dry-run        # show what would happen
//   npm run players:accounts -- --reset <player-id> [--email new@example.com]
//   npm run players:accounts -- … --branch production
//
// `--reset` deletes the player's current auth user and issues a new
// temporary password (optionally under a new email): the "forgot password"
// path. Temporary passwords are printed once to stdout and stored nowhere.
// Requires the Neon CLI, signed in, with the project linked (`neon link`).
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { neon as createSql } from "@neondatabase/serverless";

const { values: args } = parseArgs({
  options: {
    branch: { type: "string" },
    reset: { type: "string" },
    email: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const dryRun = args["dry-run"];

if (args.email && !args.reset) {
  console.error("--email can only be used with --reset <player-id>.");
  process.exit(1);
}
const newEmail = args.email?.trim().toLowerCase();
if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
  console.error(`"${args.email}" isn't a valid email address.`);
  process.exit(1);
}

const branchArgs = args.branch ? ["--branch", args.branch] : [];
const neon = (...cmd) =>
  execFileSync("neon", [...cmd, ...branchArgs], { encoding: "utf8" });

// Resolve the branch once and use its id for the database too, so the
// accounts and the auth users can never end up on different branches.
const status = JSON.parse(neon("neon-auth", "status", "-o", "json"));
const baseUrl = status.base_url;
const branchId = status.branch_id;
console.log(`Neon branch: ${branchId}${dryRun ? " (dry run)" : ""}`);

const connectionString = execFileSync(
  "neon",
  ["connection-string", branchId, "--pooled"],
  { encoding: "utf8" },
).trim();
// The HTTP driver works on networks that block Postgres' TCP port.
const sql = createSql(connectionString);

const hasAdminRole = (role) =>
  (role ?? "")
    .split(",")
    .map((r) => r.trim())
    .includes("admin");

/** 16 unambiguous characters, grouped for reading aloud: abcd-efgh-… */
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from(
    { length: 16 },
    () => alphabet[randomInt(alphabet.length)],
  );
  return chars.join("").match(/.{4}/g).join("-");
}

const findAuthUserByEmail = async (email) =>
  (
    await sql`select id, role from neon_auth."user" where lower(email) = ${email}`
  )[0];

// ── Work out who needs an account ─────────────────────────────────────

let targets;
if (args.reset) {
  const [row] = await sql`
    select a.player_id, a.email, a.user_id, p.name
    from player_accounts a join players p on p.id = a.player_id
    where a.player_id = ${args.reset}`;
  if (!row) {
    console.error(
      `No account email is set for player "${args.reset}". Add one in /admin first.`,
    );
    process.exit(1);
  }
  if (row.user_id) {
    const [current] =
      await sql`select role from neon_auth."user" where id = ${row.user_id}`;
    if (hasAdminRole(current?.role)) {
      console.error(
        `${row.email} is also an admin account; reset it manually rather than deleting it.`,
      );
      process.exit(1);
    }
    console.log(`Removing the current account for ${row.name}…`);
    if (!dryRun) {
      if (current) neon("neon-auth", "user", "delete", row.user_id);
      await sql`
        update player_accounts
        set user_id = null, must_change_password = true
        where player_id = ${row.player_id}`;
    }
  }
  if (newEmail && newEmail !== row.email) {
    console.log(`Changing ${row.name}'s email to ${newEmail}…`);
    if (!dryRun) {
      await sql`update player_accounts set email = ${newEmail} where player_id = ${row.player_id}`;
    }
    row.email = newEmail;
  }
  targets = [row];
} else {
  targets = await sql`
    select a.player_id, a.email, p.name
    from player_accounts a join players p on p.id = a.player_id
    where a.user_id is null
    order by p.sort_order`;
}

if (targets.length === 0) {
  console.log("Every invited player already has an account. Nothing to do.");
  process.exit(0);
}

// An existing auth user with the player's email (e.g. an admin who also
// plays) is linked as-is and keeps its password; everyone else gets a new
// account. A reset always issues a fresh account.
const toCreate = args.reset ? [...targets] : [];
const results = [];
for (const target of args.reset ? [] : targets) {
  const existing = await findAuthUserByEmail(target.email);
  if (!existing) {
    toCreate.push(target);
    continue;
  }
  const [claimed] =
    await sql`select player_id from player_accounts where user_id = ${existing.id}`;
  if (claimed) {
    results.push({
      ...target,
      outcome: `skipped: already linked to "${claimed.player_id}"`,
    });
    continue;
  }
  if (!dryRun) {
    await sql`
      update player_accounts
      set user_id = ${existing.id}, must_change_password = false
      where player_id = ${target.player_id}`;
  }
  results.push({ ...target, outcome: "linked existing account" });
}

// ── Create the missing accounts ───────────────────────────────────────

const setSignUpDisabled = (disabled) =>
  neon(
    "neon-auth",
    "config",
    "email-password",
    "update",
    "--disable-sign-up",
    String(disabled),
  );

if (toCreate.length > 0 && dryRun) {
  for (const target of toCreate) {
    results.push({ ...target, outcome: "would create account" });
  }
} else if (toCreate.length > 0) {
  try {
    setSignUpDisabled(false);
    for (const target of toCreate) {
      const password = temporaryPassword();
      try {
        // Localhost is a trusted origin on Neon Auth while `allow_localhost` is on.
        const response = await fetch(`${baseUrl}/sign-up/email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:4321",
          },
          body: JSON.stringify({
            email: target.email,
            password,
            name: target.name,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.user?.id) {
          throw new Error(
            `sign-up failed (${response.status}): ${body.message ?? body.code ?? "unknown error"}`,
          );
        }
        await sql`
          update player_accounts
          set user_id = ${body.user.id}, must_change_password = true
          where player_id = ${target.player_id}`;
        results.push({ ...target, outcome: "created", password });
      } catch (error) {
        results.push({ ...target, outcome: `failed: ${error.message}` });
      }
    }
  } finally {
    setSignUpDisabled(true);
    console.log("Public sign-up is disabled.");
  }
}

// ── Report ────────────────────────────────────────────────────────────

console.log("");
console.table(
  results.map((r) => ({
    player: r.name,
    email: r.email,
    "temporary password": r.password ?? "",
    result: r.outcome,
  })),
);
if (results.some((r) => r.password)) {
  console.log(
    "\nSend each player their temporary password privately. They sign in at /login and must choose a new one.",
  );
}
if (results.some((r) => r.outcome.startsWith("failed"))) process.exit(1);
