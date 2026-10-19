# EAYL Taskmaster

The frontend for a **Taskmaster-style competition** run by the Engineering
Academy. Every Friday a new task is released; players have one week to complete
it, earn points, and climb the leaderboard. ~25 players, 16 weeks, one winner.

The UI has a deliberate **terminal / CRT aesthetic** — monospace, green-on-black,
window chrome — and is built with **Astro + TypeScript + Tailwind v4**, rendered
on request on **Cloudflare Workers**.

> Competition data (players, teams, tasks, scores, bonus points) and the
> editorial copy (weekly recaps, changelog) live in **Neon Postgres** and are
> read **on every request**, so changes made in the [admin area](#-admin)
> appear on the public site immediately.

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
- [Neon Object Storage](https://neon.com/docs/storage/overview)
  (S3-compatible) for task submission photos, via
  [`aws4fetch`](https://github.com/mhart/aws4fetch)
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
│   └── AdminLayout.astro  # site Layout + admin sub-nav (noindex)
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
│   ├── editorial.ts   # rows → recap copy + changelog entries
│   ├── poll-queries.ts # poll selectors: who can vote / see results
│   ├── notification-queries.ts # a player's feed (tasks, polls, results, bonuses), derived
│   ├── votes.ts       # a player's own poll votes
│   ├── submissions.ts # task entries: per-task loader + a player's own writes
│   ├── submission-queries.ts # entry selectors: who can submit / see what
│   ├── reactions.ts   # emoji reactions on entries: per-task loader + toggle
│   ├── peoples-choice.ts # People's Choice votes: window, winners, bonus, writes
│   ├── gallery-queries.ts # gallery selectors: who can react / vote, tallies
│   ├── predictions.ts # winner predictions: mapper, bonus, writes
│   ├── prediction-queries.ts # prediction panel: options, secrecy, tally
│   ├── live.ts        # results night: loads a held week's scores
│   ├── live-queries.ts # live board + admin running order (bottom first)
│   ├── rules-queries.ts # facts quoted on /rules (bonus values, limits, squads)
│   ├── queries.ts     # createQueries(data) — derived selectors (the UI's API)
│   ├── admin.ts       # admin reads/writes (one transaction per save)
│   └── accounts.ts    # player sign-in accounts + self-service profile edits
├── lib/
│   ├── auth.ts        # Neon Auth adapter for Astro (sign in/out, session)
│   ├── login-limit.ts # per-IP throttle on sign-in attempts
│   ├── admin-forms.ts # admin form parsing + validation (zod)
│   ├── account-forms.ts # player profile + password form validation
│   ├── submission-forms.ts # entry form parsing, limits + photo type sniffing
│   ├── reactions.ts   # the reaction emoji set
│   └── storage.ts     # Object Storage client (put, presigned get, delete)
├── pages/
│   ├── admin/                 # /admin — dashboard, CRUD, scores (login.ts redirects to /login)
│   ├── login.astro            # /login — sign-in for players and admins
│   ├── logout.ts              # POST /logout — signs out
│   ├── account/               # /account — edit own profile, change password, vote in polls, notifications, submit entries, react / vote People's Choice, predict winners
│   ├── submissions/           # /submissions/[id]/media — access-checked photo links
│   ├── index.astro            # homepage
│   ├── tasks/                 # /tasks and /tasks/[id]
│   ├── players/               # /players and /players/[id]
│   ├── leaderboard.astro      # full standings (with rank movement)
│   ├── recaps/                # /recaps and /recaps/[id] weekly episode recaps
│   ├── live.astro             # /live — results night, revealed bottom first
│   ├── rules.astro            # /rules — how to play, scoring, bonuses, the prize
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
- `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION` — the branch's Object Storage endpoint and a
  `storage:read` + `storage:write` credential, for submission photos. Pull
  them with `neon env pull --services object-storage`. Optional
  `STORAGE_BUCKET` (default `uploads`) names the private bucket.

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
grid, record bonus points or deductions, run [results night](#-results-night),
and write the weekly recap copy (`/admin/recaps`) and the homepage changelog
(`/admin/changelog`). Deletes ask for confirmation and list what else will be
removed. Forms are plain HTML posts, so they work without JavaScript.

- **Score history:** every saved change to a week's scores or bonuses is
  written to `score_audit_log` (who, when, and the points and note before
  and after) in the same transaction, and listed newest first at the bottom
  of that week's admin scores page. Saving the grid only touches rows that
  changed, so each score keeps its `created_at` (when it was first recorded)
  and gets a fresh `updated_at` when edited.

- The admin panel is part of the site: admin pages keep the normal navbar,
  footer and command palette, with an admin sub-nav underneath (sections are
  defined once in `src/lib/admin-nav.ts`). Admins also get the admin
  sections in the command palette (⌘K) and an **edit** shortcut on public
  player, team, task and recap pages.
- Everyone signs in at `/login` (email + password via Neon Auth); admins land
  on `/admin`. The old `/admin/login` URL redirects there. Only users with the
  `admin` role get into `/admin`; anyone else is told so and, if they're a
  player, pointed to their profile.
- Sign-in attempts are throttled per IP (20 a minute) by the `LOGIN_LIMITER`
  rate-limit binding in `wrangler.jsonc`.
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
`ACCESS GRANTED` decrypt animation. Every task's brief, protected or not, is
withheld from public pages and feeds until its release date.

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

## 📸 Task submissions

Players submit entries from the task page while a task is live. Each task
sets, on the admin task form, how many **entries** it takes (0 = closed, the
default) and which **kinds**:

- **Photo:** JPEG, PNG, WebP, GIF or AVIF, up to 15 MB, with an optional
  caption. The file's bytes decide its type (SVG is never accepted; iPhone
  HEIC gets a hint to export as JPEG). Photos go to the private `uploads`
  bucket in Neon Object Storage, under
  `submissions/<task>/<player|team>-<id>/<uuid>.<ext>`.
- **Text:** up to 5000 characters.

On **team tasks** entries belong to the squad: any member can submit or
withdraw them, and the limit is per squad. Players can withdraw an entry
(freeing the slot) until the deadline, but not edit it. The entry form is a
plain `POST` to `/account/submissions/<task>`, so it needs a signed-in player
and works without JavaScript. The entry count and the insert are one
statement, so double-submits can't go over the limit.

Until the deadline only the player (or squad) and admins can see an entry.
Afterwards every entry shows in a gallery on the task page, unless an admin
hid it. Photos are served through `/submissions/<id>/media`, which checks
access and redirects to a short-lived presigned URL, so the bucket stays
private.

Admins review entries at `/admin/submissions/<task>`: one card per player
(or squad) with their entries and a points + note box that saves through the
same score sheet (and audit log) as `/admin/scores`. Entries can be hidden
from the public gallery or deleted. Deleting an entry, task, player or team
also deletes its photos from storage.

Once a task is **completed**, the same page can add a photo or text entry on
a player's behalf (e.g. one they sent over WhatsApp). Pick the player and
upload. On team tasks the entry goes to the player's squad. Admin-added entries
ignore the task's entry limit and allowed kinds (they work even when on-site
entries were closed), and they go straight into the public gallery.

## 🎬 Results night

Admins can **hold** a week's results (from `/admin/live/<task>` or the
week's scores page). While held, the public snapshot leaves out that week's
scores and recorded bonuses, so the leaderboard, task page, recap, stats and
notifications all behave as if it hadn't been scored, while admins see
everything as normal.

Once the deadline has passed, `/live` shows the held week's board. Each
"reveal next" in `/admin/live/<task>` uncovers one more result, **last place
first**, until the winner; only revealed results ever reach the page, and an
open `/live` tab polls itself so it follows the show without a reload.
**Publish** ends the show: the results go out site-wide and the "results are
in" notifications are dated from then (`tasks.results_published_at`).
"Release hold" ends it without a show. The state lives on the task
(`results_held_at`, `results_reveal_count`).

## ⭐ Reactions & People's Choice

Once a task's deadline passes and its gallery goes up, signed-in players can
leave emoji reactions on entries (`submission_reactions`; the buttons update
in place with JS and post normally without it) and cast one **People's
Choice** vote for their favourite entry, never their own or their squad's
(`peoples_choice_votes`). Voting stays open for 3 days after the deadline and
vote counts stay hidden until it closes. The most-voted entry's owner (every
member, for a squad entry; ties all win) then earns +1 bonus point in that
week. Like poll-voting bonuses, it's derived from the votes rather than
stored, so a withdrawn vote or a hidden entry never leaves stray points.
The window and points are constants in `src/data/peoples-choice.ts` (the
`/rules` page reads them from there too).

## 🔮 Predictions

While a task is live, players can **call the winner** from its task page: a
player on individual tasks, a squad on team tasks, never themselves or their
own squad (`predictions`). Calls stay secret until the deadline (only a
count shows), then everyone's picks are revealed. A correct call (a shared
first place counts) earns +1 bonus point once the results are published,
derived from the results so a corrected score can't leave a stale bonus.

## 🔔 Notifications

Signed-in **players** get a bell in the navbar with an unread count. It opens
a dropdown (a full-height drawer on phones) listing the newest 20 events:

- **Tasks** once their release date passes, and published **polls** once
  they open.
- **Deadline reminders** from 24 hours before a live task closes, until it
  does.
- **Results**, once the first score for a week is saved (or, for results
  held for [results night](#-results-night), once they're published), with
  the player's own finish.
- **Rank climbs** ("You moved up to #3"), when a week's results lift the
  player up the leaderboard.
- **Bonuses and deductions** the player is given (not the automatic
  poll-voting, People's Choice or prediction bonuses).

Guests and admin accounts without a player profile don't see it.

The feed is derived from the competition snapshot, so nothing is written
when a task or poll goes live. Results and bonuses are dated by the
`created_at` of their score and bonus rows. The only stored fact is
`player_accounts.notifications_read_at`: opening the panel `POST`s to
`/account/notifications/read`, which sets it to `now()`, and anything newer
is unread. Without JavaScript the bell links to `/account/notifications`,
which lists the feed with a "mark all read" button.

## 👤 Player accounts

Players sign in at `/login` (the same page admins use) with an email and
password. Signing in takes them straight to the homepage (or back to the
`/account` page that sent them to sign in). They edit **their own bio and
avatar URL** at `/account`; changes are
live immediately. Name, id, roster position, team and scores stay admin-only.
There is no public sign-up: admins invite players. Admins (including those
who also play) land on `/admin` after signing in; an admin account without a
player profile that tries to open `/account` is pointed to `/admin`.

The navbar shows `login` to visitors. Once signed in it becomes an
`account` dropdown (a flat list in the mobile menu) with `profile` for
players, `admin` for admins, and `logout`. Logging out is a `POST` to
`/logout`. The session is only looked up when the request carries a Neon Auth
session cookie, so anonymous page views make no auth call, and signed-in
pages are sent `Cache-Control: private, no-store`.

**New players:** in `/admin/players/new`, fill in the optional **sign-in
email**. Saving creates the player and their Neon Auth account together
(using the admin's own session, so public sign-up stays disabled) and shows
the temporary password **once** (it's stored nowhere). If that email already
has a sign-in account, or the account can't be created, nothing is saved and
the form says why. Send the player their temporary password privately; on
first sign-in they must choose a new one.

**Existing players** (or in bulk):

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

**Forgotten password:** in `/admin/players/<id>`, use **reset password**
under the sign-in account. It sets a new temporary password (shown to the
admin once, stored nowhere), signs the player out everywhere, and makes them
choose a new password at their next sign-in. Accounts that also hold the
`admin` role are refused.

**Changing a player's email:**
`npm run players:accounts -- --reset <player-id> [--email new@example.com]`
deletes the player's auth user and issues a new temporary password
(optionally under a new email). Accounts that also hold the `admin` role are
never deleted by the script.

The admin player list shows each player's account status: no email,
invited, temporary password or active. `/account` and `/login` are `no-store`
and `noindex`, and a player-only account can't reach `/admin`.

## ☁️ Deployment (Cloudflare Workers)

Once [CI](.github/workflows/ci.yml) (format, lint, type-check, tests, build)
passes for a push to `main`, [`deploy.yml`](.github/workflows/deploy.yml)
builds that same commit and runs `wrangler deploy`; a failed CI run never
deploys. It can also be run by hand from the Actions tab. Configure these
repository secrets:

| Secret                    | Value                                                                       |
| :------------------------ | :-------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`    | API token with the "Edit Cloudflare Workers" template                       |
| `CLOUDFLARE_ACCOUNT_ID`   | Your Cloudflare account id                                                  |
| `DATABASE_URL`            | Pooled connection string for the `production` branch                        |
| `NEON_AUTH_BASE_URL`      | `neon neon-auth status --branch production` base URL                        |
| `NEON_AUTH_COOKIE_SECRET` | `openssl rand -base64 32`                                                   |
| `AWS_ENDPOINT_URL_S3`     | `production` branch Object Storage endpoint                                 |
| `AWS_ACCESS_KEY_ID`       | `token_id` of a `storage:read` + `storage:write` credential on `production` |
| `AWS_SECRET_ACCESS_KEY`   | that credential's `s3_secret_access_key`                                    |

Create the storage credential with
`neon credentials create --scope storage:read --scope storage:write --name taskmaster-site --branch production`
(the secret is shown once). The endpoint is in `neon config status` or the
console's **Connect → Storage** tab.

Everything except the Cloudflare values is synced to the Worker as secrets on
each deploy (the site fails closed if any is missing). Then, once:

1. Remove any old DNS records for `eayltaskmaster.co.uk` and
   `www.eayltaskmaster.co.uk` (e.g. GitHub Pages). `wrangler deploy` attaches
   both as **Custom Domains** (see `routes` in `wrangler.jsonc`), creating the
   DNS records and certificates; `www` is 301-redirected to the apex.
2. Disable GitHub Pages for the repository.
3. If you also use the `*.workers.dev` URL, add it as a trusted domain:
   `neon neon-auth domain add https://<name>.workers.dev --branch production`
   (`https://eayltaskmaster.co.uk` is already trusted).

To test the built Worker locally, put the Neon and storage secrets in
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

| Command                    | Action                                                  |
| :------------------------- | :------------------------------------------------------ |
| `npm install`              | Install dependencies                                    |
| `npm run dev`              | Start the dev server at `localhost:4321`                |
| `npm run build`            | Build the production site to `./dist/`                  |
| `npm run preview`          | Preview the production build locally                    |
| `npm run deploy`           | Build and deploy to Cloudflare Workers                  |
| `npm run admin:create`     | Create an admin account (see Admin)                     |
| `npm run players:accounts` | Create invited players' accounts (see Player accounts)  |
| `npm run check`            | Type-check + diagnostics (`astro check`)                |
| `npm test`                 | Run the unit tests (Vitest)                             |
| `npm run test:watch`       | Run the unit tests in watch mode                        |
| `npm run test:coverage`    | Run the unit tests with a coverage report (`coverage/`) |
| `npm run lint`             | Lint TypeScript and Astro files (ESLint, incl. a11y)    |
| `npm run format`           | Format the codebase with Prettier                       |
| `npm run format:check`     | Check formatting without writing changes                |
| `npm run db:check`         | Run a test query against `DATABASE_URL`                 |
| `npm run db:generate`      | Generate a SQL migration from the schema                |
| `npm run db:migrate`       | Apply pending migrations (direct URL)                   |
| `npm run db:seed`          | Insert missing initial data (idempotent)                |
| `npm run db:studio`        | Browse and edit data in Drizzle Studio                  |

Before committing, keep `npm run check`, `npm run lint`, `npm test` and
`npm run format:check` clean. Unit tests sit next to the code they cover
(`src/data/*.test.ts`, `src/lib/*.test.ts`) and build their records with the
helpers in `src/test/fixtures.ts`.

## 🔭 Roadmap

Competition data and editorial copy are live and editable from `/admin`.
