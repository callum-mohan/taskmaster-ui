# EAYL Taskmaster

The frontend for a **Taskmaster-style competition** run by the Engineering
Academy. Every Friday a new task is released; players have one week to complete
it, earn points, and climb the leaderboard. ~25 players, 16 weeks, one winner.

The UI has a deliberate **terminal / CRT aesthetic** — monospace, green-on-black,
window chrome — and is built with **Astro + TypeScript + Tailwind v4**, rendered
on request on **Cloudflare Workers**.

> Competition data (players, teams, tasks, scores, bonus points) lives in
> **Neon Postgres** and is read **on every request**, so changes made in the
> [admin area](#-admin) appear on the public site immediately. Editorial copy
> (weekly recaps, changelog) stays in TypeScript.

## 🚀 Tech stack

- [Astro](https://astro.build) (on-demand rendering, no UI framework) on
  [Cloudflare Workers](https://developers.cloudflare.com/workers/) via
  `@astrojs/cloudflare`
- TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`), with design tokens in
  [`src/styles/global.css`](src/styles/global.css)
- A live sitemap endpoint (`/sitemap-index.xml`, + `public/robots.txt`)
- [Neon](https://neon.com) Postgres + [Drizzle ORM](https://orm.drizzle.team):
  the site uses Neon's HTTP driver (`@neondatabase/serverless`); scripts and
  migrations use `pg` (node-postgres) and `drizzle-kit`
- [Neon Auth](https://neon.com/docs/auth/overview) (Managed Better Auth) for
  admin and player sign-in, via `@neondatabase/auth`
- Prettier (with `prettier-plugin-astro`)

## 📁 Project structure

```text
db/
├── seed.ts            # `npm run db:seed` — inserts missing initial rows
└── seed-data.ts       # initial data (generated from the original mock data)
drizzle/               # generated SQL migrations (`npm run db:generate`)
scripts/
├── create-admin.mjs   # `npm run admin:create` — bootstrap an admin account
└── create-player-accounts.mjs  # `npm run players:accounts` — player sign-ins
src/
├── middleware.ts      # per-request data loader + /admin and /account guards
├── components/        # Reusable, prop-driven .astro components
│   └── admin/         # admin form controls (fields, score grid, delete confirm)
├── layouts/
│   ├── Layout.astro       # <head>, nav, footer, skip link
│   └── AdminLayout.astro  # admin chrome (noindex, admin nav, sign out)
├── db/
│   ├── schema.ts      # Drizzle table definitions (the database schema)
│   ├── client.ts      # createDb(url) — node-postgres client for scripts
│   └── index.ts       # getDb() — Neon HTTP client used by the site
├── data/              # The data-access layer (the only code that imports db/)
│   ├── competition.ts # loads every table per request in one batch
│   ├── players.ts     # rows → Player ─┐
│   ├── teams.ts       # rows → Team    ├─ pure mappers
│   ├── tasks.ts       # rows → Task    │  (status derived from dates)
│   ├── scores.ts      # rows → Score  ─┤  (points → positions; bonus points)
│   ├── polls.ts       # rows → Poll   ─┘  (status, voting bonuses derived)
│   ├── poll-queries.ts # poll selectors: who can vote / see results
│   ├── notification-queries.ts # a player's feed (tasks, polls, results, bonuses), derived
│   ├── votes.ts       # a player's own poll votes
│   ├── queries.ts     # createQueries(data) — derived selectors (the UI's API)
│   ├── admin.ts       # admin reads/writes (one transaction per save)
│   ├── accounts.ts    # player sign-in accounts + self-service profile edits
│   └── recaps.ts      # editorial recap copy (TypeScript)
├── lib/
│   ├── auth.ts        # Neon Auth adapter for Astro (sign in/out, session)
│   ├── admin-forms.ts # admin form parsing + validation (zod)
│   └── account-forms.ts # player profile + password form validation
├── pages/
│   ├── admin/                 # /admin — admin portal (sign-in), dashboard, CRUD, scores
│   ├── login.astro            # /login — the player portal
│   ├── logout.ts              # POST /logout — signs out (either portal)
│   ├── account/               # /account — edit own profile, change password, vote in polls, notifications
│   ├── index.astro            # homepage
│   ├── tasks/                 # /tasks and /tasks/[id]
│   ├── players/               # /players and /players/[id]
│   ├── leaderboard.astro      # full standings (with rank movement)
│   ├── recaps/                # /recaps and /recaps/[id] weekly episode recaps
│   ├── compare/               # /compare head-to-head (+ /compare/[a]/[b])
│   ├── stats.astro            # stats & Hall of Fame awards
│   └── 404.astro
├── styles/
│   └── global.css     # design tokens (@theme) + terminal helper classes
└── types/
    └── index.ts       # shared domain + view-model types
```

### Data flow (keep this separation)

```
db/schema.ts  →  data/*.ts          →   data/queries.ts   →   pages      →   components
(Postgres)       (rows → types/ shapes)  (derived selectors)   (fetch data)   (render props)
```

- **Components never import raw records** and never compute standings — they
  render typed `Props` only.
- **Pages** get selectors with `await Astro.locals.getQueries()` (set up by
  [`src/middleware.ts`](src/middleware.ts) from
  [`src/data/queries.ts`](src/data/queries.ts)) and pass ready-to-render data
  down. The snapshot is loaded lazily, at most once per request.
- All cross-record computation (leaderboard ranking, rank movement, awards,
  head-to-head) lives in `queries.ts` as pure functions.

The database stores **facts only** (points, dates, membership). Finishing
positions, task status and totals are always derived, so they can't drift.
[`competition.ts`](src/data/competition.ts) loads every table in a single
HTTP round trip per request; the selectors are pure, synchronous functions over
that snapshot, which keeps the components unaware of the database.

## 🗄️ Database (Neon)

The workspace is linked to the Neon project `eayl-taskmaster` (see the
git-ignored `.neon` file). `neon env pull` writes the connection strings to the
git-ignored `.env.local`:

- `DATABASE_URL` — **pooled**; read by the site on every request.
- `DATABASE_URL_UNPOOLED` — **direct**; used for migrations and seeding.
- `NEON_AUTH_BASE_URL` — the branch's Neon Auth URL (admin and player sign-in).

Also add `NEON_AUTH_COOKIE_SECRET` to `.env.local` yourself (32+ random
characters: `openssl rand -base64 32`); it signs the cached session cookie.

First-time setup on a new machine:

```sh
neon link            # pick the project; also pulls .env.local
npm run db:check     # prove the connection works
```

Changing the schema:

1. Edit [`src/db/schema.ts`](src/db/schema.ts), then `npm run db:generate`.
2. Try it on a branch first: `neon checkout dev --create`, then
   `npm run db:migrate` (and `npm run db:seed` for a fresh database) and
   `npm run build`.
3. Switch back with `neon checkout production` and run `npm run db:migrate`.

If the direct Postgres port (5432) is blocked on your network, use
`npm run db:migrate:http` instead: it applies the same migrations over Neon's
HTTP driver (port 443) and records them in the same journal.

**Recording results:** use the [admin area](#-admin). Changes are live
immediately; there's nothing to rebuild.

## 🔐 Admin

`/admin` lets signed-in admins create, edit and delete players, teams (and
their members), tasks and [polls](#️-polls), enter a week's scores in one
grid, and record bonus points or deductions. Deletes ask for confirmation and list what else will be
removed. Forms are plain HTML posts, so they work without JavaScript.

- **Score history:** every saved change to a week's scores or bonuses is
  written to `score_audit_log` (who, when, and the points and note before
  and after) in the same transaction, and listed newest first at the bottom
  of that week's admin scores page. Saving the grid only touches rows that
  changed, so each score keeps its `created_at` (when it was first recorded)
  and gets a fresh `updated_at` when edited.

- Admins sign in at the **admin portal**, `/admin/login` (email + password
  via Neon Auth). Only users with the `admin` role get in; anyone else (e.g.
  a player at the wrong portal) is told so and, if they're a player, pointed
  to their profile.
- Public sign-up is **disabled** on the Neon Auth branch. Create admins with:

  ```sh
  npm run admin:create -- --email you@example.com --name "Your Name"
  # target production instead of the linked branch:
  npm run admin:create -- --email you@example.com --branch production
  ```

  It prompts for a password (or reads `ADMIN_PASSWORD`), briefly re-enables
  sign-up to create the account, grants the `admin` role, then disables
  sign-up again. Roles can also be managed in the Neon Console (Auth → Users).

- Every `/admin` request is checked in the middleware; cross-site form posts
  are rejected by Astro's origin check, and admin pages are `no-store` and
  `noindex`.
- Each Neon branch has its own users: develop against `dev`, and create
  production admins with `--branch production`.

## 🔒 Reveal passwords

A task can have an optional **reveal password** (set on the admin task form).
Once the task goes live, its title, description and brief stay encrypted
everywhere (home page, task cards, command palette, banner, `.ics`) until a
visitor enters the password on the task page. Then they get an
`ACCESS GRANTED` decrypt animation.

- Matching ignores case and surrounding spaces. A correct guess sets a signed,
  HttpOnly cookie for that task, so the visitor doesn't need it again. Changing
  the password re-locks everyone.
- Wrong guesses are throttled per IP (10 a minute) by the
  `TASK_REVEAL_LIMITER` rate-limit binding in `wrangler.jsonc`.
- The admin task page shows the password with **copy**, **reveal to
  everyone** (no password needed after that; first-time visitors still get
  the animation once) and **re-lock** buttons.
- Completed tasks are always public. Admin pages always show real content, but
  public pages don't make an exception for admins.

## 🗳️ Polls

Admins run homepage polls from `/admin/polls`. Signed-in **players** vote on
the homepage; visitors see the poll read-only with a sign-in link, and admin
accounts without a player profile can't vote. Each poll sets:

- **Type:** single choice, or multiple choice with a min/max number of picks
  (blank max = no limit).
- **Options:** 2–40. Type them in, or use **+ every player** / **+ every team**
  and edit the list. Renaming an option keeps its votes; clearing a row
  deletes it and its votes.
- **Schedule:** open and close times (wall-clock, like tasks), and how many
  days a closed poll stays on the homepage (0 = gone once closed). Status
  (scheduled / open / closed) comes from the dates. The edit page also has
  **open now** and **close now** buttons.
- **Show results:** always, after voting, after it closes, or admins only.
- **Voters:** anonymous (counts only) or public (names next to each option).
- **Vote changes:** allowed until the poll closes, or the first vote is final.
- **Published:** untick to keep the poll as a hidden draft.
- **Voting bonus:** points each voter earns (default 1, 0 turns it off),
  once per poll however many options they pick. They count in the week live
  when the poll opens, or a week the admin picks, and show in that week's
  bonus ledger on player and task pages. The bonus is worked out from the
  votes, not stored: withdrawing a vote, resetting votes or deleting the poll
  removes it. The admin scores page lists it for that week (read-only).

The homepage shows every open poll (newest first) followed by recently closed
ones. You can **duplicate** a poll (its votes aren't copied) or **reset votes**
on it. Votes are a `POST` to `/account/polls/<id>`, so the `/account` guard
requires a signed-in player who has replaced their temporary password.

## 🔔 Notifications

Signed-in **players** get a bell in the navbar with an unread count. It opens
a dropdown (a full-height drawer on phones) listing the newest 20 events:

- **Tasks** once their release date passes, and published **polls** once
  they open.
- **Deadline reminders** from 24 hours before a live task closes, until it
  does.
- **Results**, once the first score for a week is saved, with the player's
  own finish.
- **Rank climbs** ("You moved up to #3"), when a week's results lift the
  player up the leaderboard.
- **Bonuses and deductions** the player is given (not the automatic
  poll-voting bonus).

Guests and admin accounts without a player profile don't see it.

The feed is derived from the competition snapshot, so nothing is written
when a task or poll goes live. Results and bonuses are dated by the
`created_at` of their score and bonus rows. The only stored fact is
`player_accounts.notifications_read_at`: opening the panel `POST`s to
`/account/notifications/read`, which sets it to `now()`, and anything newer
is unread. Without JavaScript the bell links to `/account/notifications`,
which lists the feed with a "mark all read" button.

## 👤 Player accounts

Players sign in at the **player portal**, `/login`, with an email and
password. Signing in takes them straight to the homepage (or back to the
`/account` page that sent them to sign in). They edit **their own bio and
avatar URL** at `/account`; changes are
live immediately. Name, id, roster position, team and scores stay admin-only.
There is no public sign-up: admins invite players. An admin account without
a player profile is turned away from `/login` with a link to `/admin`; an
admin who also plays can use either portal.

The navbar shows `login` to visitors. Once signed in it becomes an
`account` dropdown (a flat list in the mobile menu) with `profile` for
players, `admin` for admins, and `logout`. Logging out is a `POST` to
`/logout`. The session is only looked up when the request carries a Neon Auth
session cookie, so anonymous page views make no auth call, and signed-in
pages are sent `Cache-Control: private, no-store`.

1. In `/admin/players/<id>`, fill in the **sign-in account** email. Emails
   live in a separate `player_accounts` table and are never shown publicly.
2. Create the accounts (on the linked branch, or add `--branch production`):

   ```sh
   npm run players:accounts -- --dry-run   # preview
   npm run players:accounts
   ```

   This creates a Neon Auth user for every invited player without an
   account, with a random temporary password, and prints a table of
   temporary passwords **once** (they're stored nowhere). Like
   `admin:create`, it briefly re-enables sign-up and always disables it
   again. Re-running it only handles new invites. If an auth user already
   exists with that email (e.g. an admin who also plays), it is linked and
   keeps its password.

3. Send each player their temporary password privately. On first sign-in
   they must choose a new password before they can do anything else.

**Forgotten password / changing a player's email:**
`npm run players:accounts -- --reset <player-id> [--email new@example.com]`
deletes the player's auth user and issues a new temporary password
(optionally under a new email). Accounts that also hold the `admin` role are
never deleted by the script.

The admin player list shows each player's account status: no email,
invited, temporary password or active. `/account` and `/login` are `no-store`
and `noindex`, and a player-only account can't reach `/admin`.

## ☁️ Deployment (Cloudflare Workers)

Pushing to `main` runs [`deploy.yml`](.github/workflows/deploy.yml), which
builds the site and runs `wrangler deploy`. Configure these repository
secrets:

| Secret                    | Value                                                 |
| :------------------------ | :---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`    | API token with the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID`   | Your Cloudflare account id                            |
| `DATABASE_URL`            | Pooled connection string for the `production` branch  |
| `NEON_AUTH_BASE_URL`      | `neon neon-auth status --branch production` base URL  |
| `NEON_AUTH_COOKIE_SECRET` | `openssl rand -base64 32`                             |

The last three are synced to the Worker as secrets on each deploy (the site
fails closed if any is missing). Then, once:

1. Remove any old DNS records for `eayltaskmaster.co.uk` and
   `www.eayltaskmaster.co.uk` (e.g. GitHub Pages). `wrangler deploy` attaches
   both as **Custom Domains** (see `routes` in `wrangler.jsonc`), creating the
   DNS records and certificates; `www` is 301-redirected to the apex.
2. Disable GitHub Pages for the repository.
3. If you also use the `*.workers.dev` URL, add it as a trusted domain:
   `neon neon-auth domain add https://<name>.workers.dev --branch production`
   (`https://eayltaskmaster.co.uk` is already trusted).

To test the built Worker locally, put the three secrets in
`dist/server/.dev.vars` (git-ignored) after `npm run build`, then run
`npx wrangler dev --config dist/server/wrangler.json`.

## 🎨 Styling

All colours, fonts and effects come from design tokens defined in the
`@theme` block of [`src/styles/global.css`](src/styles/global.css), which
Tailwind turns into utilities (`text-acid`, `bg-term-panel`, `border-grid`, …).
**Never hard-code hex values in components** — use the tokens. Helper classes
(`.prompt`, `.text-glow`, `.caret`, `.live-dot`) and all motion respect
`prefers-reduced-motion`.

## 🧞 Commands

Run from the project root:

| Command                    | Action                                                 |
| :------------------------- | :----------------------------------------------------- |
| `npm install`              | Install dependencies                                   |
| `npm run dev`              | Start the dev server at `localhost:4321`               |
| `npm run build`            | Build the production site to `./dist/`                 |
| `npm run preview`          | Preview the production build locally                   |
| `npm run deploy`           | Build and deploy to Cloudflare Workers                 |
| `npm run admin:create`     | Create an admin account (see Admin)                    |
| `npm run players:accounts` | Create invited players' accounts (see Player accounts) |
| `npm run check`            | Type-check + diagnostics (`astro check`)               |
| `npm run format`           | Format the codebase with Prettier                      |
| `npm run format:check`     | Check formatting without writing changes               |
| `npm run db:check`         | Run a test query against `DATABASE_URL`                |
| `npm run db:generate`      | Generate a SQL migration from the schema               |
| `npm run db:migrate`       | Apply pending migrations (direct URL)                  |
| `npm run db:seed`          | Insert missing initial data (idempotent)               |
| `npm run db:studio`        | Browse and edit data in Drizzle Studio                 |

Before committing, keep `npm run check` and `npm run format:check` clean.

## 🔭 Roadmap

Competition data is live and editable from `/admin`. Next steps: recaps in
the database and player submissions.
