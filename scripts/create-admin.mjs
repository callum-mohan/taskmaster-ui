// Creates an admin account for the /admin area on a Neon branch.
//
// Neon Auth has public sign-up disabled, and the CLI can't set a password,
// so this briefly re-enables sign-up, signs the user up with a password,
// grants the `admin` role, and always disables sign-up again.
//
// Usage:
//   npm run admin:create -- --email you@example.com --name "Your Name"
//   npm run admin:create -- --email … --branch production
//
// The password is read from ADMIN_PASSWORD or prompted for (hidden).
// Requires the Neon CLI, signed in, with the project linked (`neon link`).
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    branch: { type: "string" },
  },
});

if (!args.email) {
  console.error(
    'Usage: npm run admin:create -- --email <email> [--name "Name"] [--branch <branch>]',
  );
  process.exit(1);
}

const branchArgs = args.branch ? ["--branch", args.branch] : [];
const neon = (...cmd) =>
  execFileSync("neon", [...cmd, ...branchArgs], { encoding: "utf8" });

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => write(text.startsWith(question) ? text : "");
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password =
  process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (12+ chars): "));
if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}

const status = JSON.parse(neon("neon-auth", "status", "-o", "json"));
const baseUrl = status.base_url;
console.log(`Neon Auth branch: ${status.branch_id}`);

const setSignUpDisabled = (disabled) =>
  neon(
    "neon-auth",
    "config",
    "email-password",
    "update",
    "--disable-sign-up",
    String(disabled),
  );

let userId;
try {
  setSignUpDisabled(false);
  // Localhost is a trusted origin on Neon Auth while `allow_localhost` is on.
  const response = await fetch(`${baseUrl}/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:4321",
    },
    body: JSON.stringify({
      email: args.email,
      password,
      name: args.name ?? args.email,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.user?.id) {
    throw new Error(
      `Sign-up failed (${response.status}): ${body.message ?? body.code ?? "unknown error"}`,
    );
  }
  userId = body.user.id;
} finally {
  setSignUpDisabled(true);
  console.log("Public sign-up is disabled.");
}

neon("neon-auth", "user", "set-role", userId, "--roles", "admin");
console.log(`Created admin ${args.email} (${userId}). Sign in at /admin.`);
