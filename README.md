# EAYL Taskmaster

The frontend for a **Taskmaster-style competition** run by the Engineering
Academy. Every Friday a new task is released; players have one week to complete
it, earn points, and climb the leaderboard. ~25 players, 16 weeks, one winner
per season, with every champion kept in the [Hall of Fame](#-seasons--hall-of-fame).

The UI has a deliberate **terminal / CRT aesthetic** — monospace, green-on-black,
window chrome — and is built with **Astro + TypeScript + Tailwind v4**, rendered
on request on **Cloudflare Workers**.

> Competition data (players, teams, tasks, scores, bonus points) and the
> editorial copy (weekly recaps, changelog) live in **Neon Postgres**. Public
> pages read them through a short-lived edge cache that every admin or player
> change clears, so changes made in the [admin area](#-admin) appear on the
> public site straight away (see [Caching](#-caching)).

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
│   ├── competition.ts # loads every table in one batch (edge-cached rows), builds a season's snapshot
│   ├── seasons.ts     # rows → Season (status derived), season lookups, rowsForSeason
│   ├── season-close.ts # what still stops a season being closed
│   ├── hall-of-fame-queries.ts # closed seasons' podiums, squads, awards + all-time records
│   ├── streak-queries.ts # win / podium / scoring streaks, one-week climbs, comebacks
│   ├── wrapped-queries.ts # the season wrapped + each player's wrapped (personas, highs, rivals)
│   ├── mini-tasks.ts  # rows → MiniTask (status derived from UK dates) + completions
│   ├── mini-task-queries.ts # what's running, a player's ticks and tally
│   ├── achievement-queries.ts # the achievements catalogue and a player's progress
│   ├── activity-queries.ts # the admin activity log (score history + coin records)
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
│   ├── admin-season.ts # which season an admin screen works on (?season=)
│   ├── season-scope.ts # a record's season + its selectors, for detail pages
│   ├── account-forms.ts # player profile + password form validation
│   ├── submission-forms.ts # entry form parsing, limits + photo type sniffing
│   ├── reactions.ts   # the reaction emoji set
│   └── storage.ts     # Object Storage client (put, presigned get, delete)
├── pages/
│   ├── admin/                 # /admin — dashboard, seasons, weeks/<id>/{judge,live,recap}, roster, site, guide (login.ts redirects to /login)
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
│   ├── stats.astro            # the current season's stats, streaks, comebacks & awards
│   ├── hall-of-fame.astro     # every closed season's champions + all-time records
│   ├── seasons/               # /seasons/[id] — a season's final standings (/seasons → hall of fame), plus /seasons/[id]/wrapped and /seasons/[id]/wrapped/[player]
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
  down. Every snapshot covers one season: the current one by default, or
  `getQueries(seasonId)` for another. Pages about one player, squad or week
  use `recordScope` (`src/lib/season-scope.ts`) to load that record's season.
  The rows are loaded lazily, at most once per request, and each season's
  snapshot is built from them at most once.
- All cross-record computation (leaderboard ranking, rank movement, awards,
  head-to-head) lives in `queries.ts` as pure functions.

The database stores **facts only** (points, dates, membership). Finishing
positions, task status and totals are always derived, so they can't drift.
[`competition.ts`](src/data/competition.ts) loads every table in a single
HTTP round trip (or from the edge cache, see below); the selectors are pure,
synchronous functions over that snapshot, which keeps the components unaware
of the database.

### ⚡ Caching

The Neon database is in `us-east-2` while the players are in the UK, and the
Free plan has a monthly network transfer allowance, so the snapshot's raw
rows are cached at the edge rather than read on every page view:

- **What's cached:** only the raw table rows, which are the same for every
  viewer. Reveal cookies, held results and derived state (task status,
  deadlines, notifications) are still worked out on every request, so a
  task still goes live on the minute.
- **Where:** Cloudflare's Cache API (`caches.default`), per data centre, for
  5 minutes (`ROWS_CACHE_TTL_SECONDS`). It needs no binding. The key
  includes the deployed Worker version (`CF_VERSION_METADATA`), so a deploy
  starts with a cold cache.
- **Invalidation:** any `POST` by a signed-in admin or player (under
  `/admin` or `/account`) purges the cached rows in that data centre before
  its redirect, so the writer always sees their change. Writes that never
  touch competition data (marking notifications read, changing a password)
  skip it (`isCompetitionNeutralRoute` in `src/lib/routes.ts`).
- **Staleness:** other data centres, and edits made from scripts or the Neon
  console, show up within 5 minutes.
- **Admins** always read the database directly; `/admin` never uses the
  cache.
- **`/live`** reads the show's state (holds, reveal counts and held scores)
  fresh on every poll with one small query, so results night stays in sync
  everywhere.

**Signed-out pages** are cached too, as rendered HTML. The Worker runs on the
Workers Free plan, whose 10 ms CPU limit per request a full render can exceed
(`Worker exceeded CPU time limit`), so a signed-out visitor's page is
rendered once per data centre and shared (`cachedPage` in
`src/lib/edge-cache.ts`, wired up in `src/middleware.ts`):

- Only `GET`s without a session or task-reveal cookie, and only plain HTML
  `200`s that set no cookie and no `Cache-Control` of their own (so `/live`,
  which sends `no-store`, never is). Signed-in pages are always rendered.
- They're kept for 60 seconds (`PAGE_CACHE_TTL_SECONDS`), which bounds how
  late time-driven changes (a week going live) reach signed-out visitors.
- The key includes a cache generation (`competitionCacheGeneration`) that is
  purged with the rows, so a write empties the page cache in that data
  centre too, and that expires with them.

The timezone helpers in `src/lib/time.ts` also memoise their `Intl` work
(per 15-minute offset slot, and per formatter), as those conversions were
the biggest share of the data layer's CPU time.

The caches are a no-op on `*.workers.dev` URLs (Cloudflare's Cache API only
works on custom domains), where every request reads the database.

## 🗄️ Database (Neon)

The workspace is linked to the Neon project `eayl-taskmaster` (see the
git-ignored `.neon` file). `neon env pull` writes the connection strings to the
git-ignored `.env.local`:

- `DATABASE_URL` — **pooled**; read by the site (see [Caching](#-caching)).
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

## 🏆 Seasons & Hall of Fame

The competition runs in **seasons** (one per academy cohort, starting with
**Cohort 2026**). Each player, squad and week belongs to exactly one season
(`season_id` on `players`, `teams` and `tasks`), so week numbers restart at 1
each season. Squads can only contain players from their own season (a
composite key on `team_members`). Ids stay unique across seasons because
they're public URLs: blank week ids in later seasons default to
`<season-id>-week-NN`.

- **Current season:** exactly one season is current (`seasons.is_current`,
  enforced by a partial unique index). The public site's lists, home page,
  leaderboard, rules and notifications all show it.
- **Status** is derived: _upcoming_ until its first week is released,
  _running_ after that, _closed_ once an admin closes it.
- **Closing** (`seasons.closed_at`) crowns the champion. It's only allowed
  once every week is over with its results in and published. The podium,
  winning squad and awards are always derived from the final standings,
  never stored. A closed season is read-only: the middleware refuses
  writes to its weeks, roster and scores until it's reopened.
- **Public archive:** `/hall-of-fame` lists every closed season's champion,
  podium, winning squad and awards, plus all-time records (highest season
  total, biggest winning margin, most weekly wins, best single week, longest
  win streak and podium run, biggest one-week climb, greatest comeback).
  `/seasons/<id>` shows a season's standings, squads, awards and weeks.
  Player, squad, task and recap URLs from past seasons keep working, with an
  "archived season" banner. Seasons being prepared (not current, not closed)
  are hidden from the public.
- **Wrapped:** closing a season also publishes its wrapped.
  `/seasons/<id>/wrapped` reviews the whole season: the numbers, the
  champion, the title race (weeks at #1, lead changes, wire-to-wire), streaks,
  comebacks and awards. `/seasons/<id>/wrapped/<player>` gives every player
  their own: a playful persona, final rank, best and toughest weeks, streaks,
  awards won, the rivals either side of them, and their points chart. Until
  the season is closed both 404 for the public (`isWrappedLive`), and admins
  see a preview (linked from the season page). It's all derived from the
  standings, so nothing extra is stored.
- **Streaks & comebacks** (`streak-queries.ts`) are counted over a season's
  scored weeks: a week a player wasn't scored on breaks a streak. Win, podium
  (top 3) and scoring (points > 0) streaks need two weeks in a row to count. A
  climb is the most places gained over one week's results, and a comeback runs
  from a player's lowest rank after any week to their rank now. They feed the
  `/stats` page, player profiles, the wrapped and the Hall of Fame records.
  Streaks that include the latest week of a running season are flagged
  "still going".
- Polls and the changelog are site-wide. A poll's voting bonus only counts
  for players in the season of the week it lands in.
- Player sign-in emails are unique across all seasons, so a returning player
  needs a different email (or their old account removed) for a new season's
  player record.

## 🔐 Admin

`/admin` is grouped into six areas, and `/admin/guide` explains each one
along with the weekly runbook:

| Area      | Path              | What it's for                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dashboard | `/admin`          | What needs doing now: the live week, finished weeks still to judge or publish, and the next week to be released, each with a button for its next step. Prompts to close a finished season or launch the next one.                                                                                                                                                               |
| seasons   | `/admin/seasons`  | Part of the weeks area. Create seasons, make one current, close one to crown its champion (or reopen it), rename, and delete empty ones. Editor at `/admin/seasons/<id>`.                                                                                                                                                                                                       |
| weeks     | `/admin/weeks`    | One row per task with its progress. Each week is a workspace with four tabs: **brief** (`/admin/weeks/<id>`: the task form, reveal password, delete), **judge** (`…/judge`: entries gallery with a points box per player or squad, or a plain grid when the task takes no entries, plus bonuses and the score history), **results night** (`…/live`) and **recap** (`…/recap`). |
| roster    | `/admin/roster`   | Players (with sign-in accounts) and squads, per season; editors at `/admin/players/<id>` and `/admin/teams/<id>`.                                                                                                                                                                                                                                                               |
| site      | `/admin/site`     | Feature flags, [polls](#️-polls), [mini-tasks](#-mini-tasks--achievements), the homepage changelog and the shop; editors at `/admin/polls/<id>`, `/admin/mini-tasks/<id>` and `/admin/changelog/<id>`; marketplace moderation at `/admin/market`.                                                                                                                                |
| activity  | `/admin/activity` | One season's timeline of everything that moved points or Clim Coin (score changes, coin grants, gifts, purchases, crates, power-ups, skills, wishes, mini-tasks, marketplace sales), filterable by kind and player, for disputes.                                                                                                                                               |
| guide     | `/admin/guide`    | How to use the admin.                                                                                                                                                                                                                                                                                                                                                           |

The weeks and roster lists, the activity log, and the new week / player / squad forms, work on
one season: the current one, or another picked with the season switcher
(`?season=<id>`, see `src/lib/admin-season.ts`). Screens about a single week,
player or squad use that record's season.

Each week's progress (brief → judge → results night → recap) is worked out
in `src/data/week-progress.ts` from the task and its counts, so it can't
drift. URLs from before the admin was regrouped (`/admin/tasks/…`,
`/admin/scores/…`, `/admin/submissions/…`, `/admin/live/…`,
`/admin/recaps/…`, and the old player, team, poll and changelog lists) are
redirected by the middleware (`legacyAdminPath` in `src/lib/admin-nav.ts`).
Deletes ask for confirmation and list what else will be removed. Forms are
plain HTML posts, so they work without JavaScript.

- **Score history:** every saved change to a week's scores or bonuses is
  written to `score_audit_log` (who, when, and the points and note before
  and after) in the same transaction, and listed newest first at the bottom
  of that week's judge tab. Saving the grid only touches rows that
  changed, so each score keeps its `created_at` (when it was first recorded)
  and gets a fresh `updated_at` when edited.
- **Activity log:** `/admin/activity` merges the season's `score_audit_log`
  with its coin records (`coin_adjustments`, `item_gifts`,
  `mini_task_completions`, purchases, crates, gifts, power-up uses, skill
  unlocks and wishes) into one newest-first timeline
  (`src/data/activity-queries.ts`), filterable by kind (`?kind=`) and by the
  player or squad affected (`?who=`). Rows deleted outright (a removed coin
  grant, a revoked power-up) leave no entry.

- The admin panel is part of the site: admin pages keep the normal navbar,
  footer and command palette, with an admin sub-nav underneath (areas and
  week tabs are defined once in `src/lib/admin-nav.ts`). Admins also get the admin
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

Admins run homepage polls from `/admin/site`. Signed-in **players** vote on
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
  removes it. The week's judge tab lists it (read-only).

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
withdraw them, and the limit is per squad. Until the deadline players can
withdraw an entry (freeing the slot) or edit a text entry or photo caption
(the photo itself can't be swapped; withdraw it and upload another). The
entry form is a plain `POST` to `/account/submissions/<task>`, so it needs a
signed-in player and works without JavaScript. With JS, photo uploads show a
progress bar: the script posts with an `x-upload-progress` header and the
endpoint answers with JSON naming the page to go back to, instead of a
redirect. The entry count and the insert are one statement, so double-submits
can't go over the limit.

Until the deadline only the player (or squad) and admins can see an entry.
Afterwards every entry shows in a gallery on the task page, unless an admin
hid it. Clicking a photo opens a full-size viewer (arrow keys or swipe
between entries, Esc to close); without JS it opens the image. Photos are
served through `/submissions/<id>/media`, which checks
access and redirects to a short-lived presigned URL, so the bucket stays
private.

Admins review entries in the week's judge tab (`/admin/weeks/<task>/judge`):
one card per player (or squad) with their entries and a points + note box,
all saved in one go as the week's score sheet (with its audit log). Tasks
that take no entries get a plain points grid there instead. Entries can be hidden
from the public gallery or deleted. Deleting an entry, task, player or team
also deletes its photos from storage.

Once a task is **completed**, the same page can add a photo or text entry on
a player's behalf (e.g. one they sent over WhatsApp). Pick the player and
upload. On team tasks the entry goes to the player's squad. Admin-added entries
ignore the task's entry limit and allowed kinds (they work even when on-site
entries were closed), and they go straight into the public gallery.

## 🎬 Results night

Admins can **hold** a week's results (from the week's results night tab,
`/admin/weeks/<task>/live`, or its judge tab). While held, the public snapshot leaves out that week's
scores and recorded bonuses, so the leaderboard, task page, recap, stats and
notifications all behave as if it hadn't been scored, while admins see
everything as normal.

Once the deadline has passed, `/live` shows the held week's board. Each
"reveal next" in the results night tab uncovers one more result, **last place
first**, until the winner; only revealed results ever reach the page, and an
open `/live` tab polls itself (every 4 seconds on air, every minute off air)
so it follows the show without a reload. The show's state is read fresh on
each poll, bypassing the [cache](#-caching).
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

## 🪙 Clim Coin

A per-season currency. Players earn **Clim Coin** and spend it in the
[`/shop`](src/pages/shop.astro) on pets, avatars, cosmetics (titles, name
colours, profile themes) and power-ups. Their balance, history and inventory
live in the wallet section of their account page (`/account#wallet`, also
linked from the navbar coin chip); everyone can see what a player wears, but
only they (and admins) see their balance and inventory.

**Earning is derived, never stored** (`src/data/coins.ts`), like the poll and
prediction bonuses, so a corrected score or withdrawn vote can't leave stale
coins behind. Results pay once published (1st 10 · 2nd 7 · 3rd 5 · anyone else
scored 2); activity pays once it locks in (entry 2 at the deadline, winner call
1 at the deadline, People's Choice vote 1 when voting closes, poll vote 1 when
the poll closes) and [mini-tasks](#-mini-tasks--achievements) pay 1–5 when an
admin ticks the player off. Every number lives in `src/data/coin-rules.ts`, which `/rules`
reads too. Wallets are per season: they belong to the season's player rows.

**Stored facts:** `shop_items` (the site-wide catalogue, edited in
`/admin/site#shop`), `coin_purchases` (price copied at purchase),
`power_up_uses`, `equipped_items`, `coin_gifts`, `coin_adjustments` (admin
grants and deductions, on the player's admin page) and `item_gifts` (see
below). A purchase or gift checks
the balance against fresh (uncached) rows, then re-checks it in the insert
under a per-player advisory lock, so concurrent spends can't overspend. A
balance can go negative if a result is corrected after spending; buying is
then blocked.

**Gifting:** from the wallet, a player can send coins to anyone else in their
season, up to 5 in any rolling 7 days (`GIFT_WEEKLY_CAP`), with an optional
80-character note. The cap is re-checked in the insert under the sender's
lock, and the recipient gets a notification.

**Admin gifts:** on a player's admin page (`/admin/players/[id]`) an admin can
gift Clim Coin (a positive `coin_adjustments` row) and any shop item: a pet,
avatar, cosmetic or power-up, including retired, egg-exclusive and
out-of-window ones. Like an egg prize, a gifted item is owned through a
zero-price `coin_purchases` row, written with its `item_gifts` row (reason
and admin's name) in one statement under the player's wallet lock. Items they
already own, and power-ups whose effect they've had this season, can't be
gifted. A gift can be taken back unless it's a power-up charge that's been
spent (revoke the use in the week's judge tab first); that also unequips it.
The player is notified and the gift shows in their wallet history.

**Limited-time stock:** `shop_items.available_from` / `available_until` (UK
wall-clock, like task dates) set a sale window. Items with an end date sit on
the shop's "limited time" shelf with a countdown; outside the window they
can't be bought or hatched.

**Power-ups** are single use: a player can buy each one once a season
(checked by effect, and enforced by a unique `power_up_uses (player_id,
effect)` constraint) and use it from the wallet on the live week, one power-up
per player per week. Uses are public immediately (task page feed):

- **Golden Week**: the player's task score ×1.5 (rounded up) before positions
  are decided. On team tasks only their own credit is boosted.
- **Double Down**: a correct winner call pays +2 instead of +1.
- **Taskmaster's Hint**: shows the week's `tasks.hint` (written on the brief
  tab) to that player only.
- **Sabotage**: −5 to any other player that week (squad-mates included); each
  player can be sabotaged once a week, and the target is notified.

**Passive power-ups** (`shield`, `mirror`, `insurance`) are bought once a
season like the others but never used: the database refuses them in
`power_up_uses`, and their effect is derived in `coins.ts`:

- **Shield** blocks, and **Mirror** bounces back onto the saboteur, the first
  Sabotage on the owner used after they bought it (a Mirror is spent before a
  Shield). The resolution is fixed when the Sabotage happens, but it's secret:
  the target takes −5 as normal until the week's results are out, then the
  deduction is dropped (Shield) or moved to the saboteur (Mirror), the task
  feed says so and both players are notified.
- **Insurance** pays 3rd-place coins instead of the base 2 for the first week
  (whose deadline was after the purchase) where the owner finished last.

**One Wish Willow** (`wish`, 10 coins, once a season, can hatch from eggs
like any power-up) is spent from the wallet, any time, by writing a wish of
up to 200 characters to the Taskmaster: a `wishes` row whose unique
`purchase_id` is the charge it spends (the database refuses `wish` in
`power_up_uses`). Wishes are private to the player and admins. They land in
the wish inbox on the admin dashboard (`/admin#wishes`, every season), where
an admin grants or declines each one with an optional reply. A decision is
final, the wish is spent either way, and the player is notified. Granting
doesn't do anything by itself: the admin makes it happen (e.g. with an
admin gift). A gifted Willow can't be taken back once its wish is made.

**Mystery eggs** (lootboxes, called crates in the code) sit behind the
`shop_eggs` [feature flag](#-feature-flags), off by default. When on, they're on the shop page:
a Mystery Egg (8 coins: Common 60%, Rare 28%, Epic 10%, Legendary 2%) and a
Fabergé Egg (15 coins: Rare 55%, Epic 35%, Legendary 10%), defined in
`coin-rules.ts` with pixel art (whole, and top/bottom halves) in
`public/shop/eggs`. **Seasonal eggs** (`exclusive: true` with a sale window,
e.g. the Haunted Egg for Halloween) are only on sale in their window and hatch
only items whose `shop_items.crate_id` names them; no other egg drops those. An item's rarity comes from its price (≤7 common, 8–14
rare, 15–19 epic, 20+ legendary). An egg only hatches available pets, avatars
and cosmetics the player doesn't own yet, so there are no duplicates; an
empty tier's chance is shared among the others, and the shop shows every
viewer their exact odds. Each egg also has a small `powerUpChance` (Mystery 2%,
Fabergé 5%, Haunted 3%) of hatching a power-up instead, picked from the ones
the player hasn't had this season; it counts as that effect's one charge for
the season, exactly like buying it. That chance is taken off the top of the
other tiers and never scaled up, and an egg with only power-ups left for a
player counts as empty, so it can't be farmed as a cheap power-up shop. The roll happens on the server
(`crypto.getRandomValues`, from fresh rows) and is written to `crate_opens`,
with a zero-price `coin_purchases` row so the prize is owned like anything
bought. Items marked **egg exclusive** in the shop editor can't be bought
directly. Cracks are public in the shop's "recently hatched" feed, and the
player watches their egg wobble, crack and split open to reveal the prize.

Effects are applied when the snapshot is derived (`competition.ts`), so
revoking a use from the week's judge tab undoes it and returns the charge.
Starter items and their pixel art (`public/shop`) are in `db/seed-data.ts`.

**Skill trees** (`/skills`, behind the `skill_trees` [feature flag](#-feature-flags))
let a player commit to one pathway a season and unlock it with Clim Coin. The
five pathways (Stormbrewer, Elite Hacker, Friendkeeper, Overachiever and
Elephant Cartographer, nods to storm mode and the squads) are defined in code
in `src/data/skill-trees.ts`. Each has a root (5), two branches (8 each, root
first) and a capstone (15, both branches first). Perks only ever touch Clim
Coin, never points:

- coin bonuses on entries, placings, calls, votes or power-ups used;
- discounts on power-ups, eggs and wearables (pets, avatars and cosmetics);
- luckier egg odds;
- a higher weekly gift cap.

The pathways are balanced on one value model: about 10 of each weekly event
in a season, 5 poll votes, 4 power-ups used and about 5 discounted purchases
of a kind. On that model every pathway's root is worth ~14 coins, its perk
branch ~16, its title branch ~10 and its capstone ~24, so a full 36-coin tree
pays back about 64. Each node's perks are listed on its card, generated from
the data. A test in `skill-trees.test.ts` fails if a retune breaks the balance.

Earning perks are derived in `deriveEarnings` and only pay on coins that land
after the node was unlocked, so they never pay out retroactively. Discounts
are applied when a player buys, and the price paid is stored. The gift cap and
egg odds come from current unlocks.

The first unlock writes a `skill_paths` row (one per player, no respec). Each
unlock is a `skill_unlocks` row at the price paid, and its composite key keeps
every unlock in that pathway. `unlockSkillNode` writes in one statement under
the wallet lock and re-checks the budget, prerequisites and pathway.

Title and name-colour rewards are `shop_items` with `skill_only` set. They're
never sold or hatched, are seeded by the `0027_skill_trees` migration and
`db/seed-data.ts`, and are owned through a zero-price `coin_purchases` row
(`skill_unlocks.purchase_id`), like crate wins.

Turning the flag off hides the page, its links and the pathway sigils. Anything
already unlocked keeps working.

**Marketplace** (`/market`, behind the `marketplace` [feature flag](#-feature-flags))
lets players resell what they own to other players in their season. Pets,
avatars, cosmetics, egg exclusives and unused power-up charges can be listed
(`isTradeable` in `coin-rules.ts`). Skill tree rewards can't, and nor can
Shield, Mirror or Insurance, because their charges are spent by derived
effects that a sale couldn't re-check. The seller sets a price between 50% and
300% of the shop price (5–60 for egg exclusives, `marketPriceRange`). Buyers
pay that price or make a lower offer. There's no fee, and listings lapse after
7 days (`MARKET_LISTING_DAYS`).

- **Stored facts:** `market_listings` (one owned copy, the seller's
  `coin_purchases` row, at a price), `market_offers` and `market_sales`.
- **Ownership:** a sale writes the buyer a zero-price `coin_purchases` row,
  like an egg prize. The seller's copy stops counting because a sale names it
  (`source_purchase_id`), so ownership, equipping and power-up charges ignore
  sold copies. Listed copies can't be worn or used. The shop, eggs and admin
  gifts still go by "ever had this season", so an item can't be bought from
  the shop and resold over and over.
- **Expiry and holds are derived:** an open listing older than 7 days reads
  as expired, and a pending offer holds the buyer's coins only while its
  listing is live. Nothing has to run when they lapse. `Wallet.balance` is
  what a player can spend after holds (`held` shows them), and the SQL
  `budget` used by every spending write subtracts them too.
- **Writes** (`src/data/market.ts`): each is one statement under the wallet
  lock. A sale (a buy, or a seller accepting an offer) takes both players'
  locks in a fixed order. It then re-checks that the listing is live at that
  price, the copy is the seller's and unused, the buyer doesn't hold the item
  (or a charge of that power-up), and they can afford it.
- **Moderation:** admins take listings down at `/admin/market`. Closing a
  season takes its open listings down. A gifted item that's been sold can't be
  revoked.
- **Notifications:** the seller hears about offers, sales and expired
  listings; the buyer hears whether their offer was accepted or declined.

## 🧩 Mini-tasks & achievements

**Mini-tasks** are small daily or bonus challenges between the weekly tasks,
worth 1–5 Clim Coin (`MINI_TASK_MAX_REWARD` in `src/data/mini-tasks.ts`, also
a check on `mini_tasks.reward`). Each belongs to a season and runs from
`starts_on` to `ends_on` (UK dates, inclusive); its status (upcoming, active,
ended) is derived on every request. Admins create them in
`/admin/site#mini-tasks` and tick off who did each one at
`/admin/mini-tasks/<id>`, which writes `mini_task_completions` (with the
admin's name, like `coin_adjustments`). The coin is **derived** from those
rows in `deriveEarnings`, so unticking someone or deleting the mini-task
takes it back. Players see what's running on the homepage and in their
account (behind the `mini_tasks` flag) and get a notification when ticked.

**Achievements** (`/account/achievements`, behind the `achievements` flag)
are the season's long-term goals: 20 milestones in four groups (results,
streaks, taking part, Clim Coin), each with a progress bar. The catalogue
lives in `src/data/achievement-queries.ts` and is derived from the snapshot
like everything else; nothing is stored. The public profile keeps its own
smaller set of "current form" badges (`getPlayerAchievements`).

## 🚩 Feature flags

Site-wide switches an admin flips in `/admin/site#flags`, with no deploy.
They're defined in `src/data/feature-flags.ts` and stored in `feature_flags`
(with who last changed each one). A flag with no row is **off**, so a new
feature ships disabled. Flags load with the rest of the competition rows
(one round trip, edge-cached); toggling one is an admin write, so the cache
is purged and the change shows straight away. Read them from
`getQueries().features`.

| Flag           | Off (default)                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shop_eggs`    | Hides the mystery eggs, recent hatches and egg-exclusive items in the shop and rules; eggs can't be opened.                                                                                                                                                              |
| `storm_mode`   | Clear skies. On: the public site (not `/admin`) is hit by a hurricane — rain, lightning, gusts, shake and "A Storm Is Brewing" blown across the screen. Pure CSS (`StormMode.astro` + `:root[data-storm]` in `global.css`), click-through, and still for reduced motion. |
| `skill_trees`  | Hides `/skills`, its nav, shop and wallet links, the rules section and pathway sigils; nobody can unlock. Perks and rewards already unlocked keep working.                                                                                                               |
| `mini_tasks`   | Hides the mini-task panels on the homepage and `/account`. Admins can still set mini-tasks and tick off completions, and coin already earned stays in wallets.                                                                                                           |
| `achievements` | Hides `/account/achievements` (404) and its links.                                                                                                                                                                                                                       |
| `marketplace`  | Hides `/market`, `/account/market` (404) and their links, the rules section and the wallet's sell links; nobody can list, buy or offer. Open listings and offers lapse on their own.                                                                                     |

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
- **Sabotage**, when another player uses the Clim Coin power-up on them, and
  once the week's results are out, whether a **Shield or Mirror** stopped it
  (the saboteur hears about a bounce too).
- **Gifts** of Clim Coin from another player, and Clim Coin grants or
  items an admin gifted them.
- **Wishes** granted or declined by the Taskmaster, with their reply.
- **Mini-tasks** an admin ticked them off for, with the coin it paid.

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
live immediately. Their Clim Coin wallet is a section of the same page (`/account#wallet`). Name, id, roster position, team and scores stay admin-only.
There is no public sign-up: admins invite players. Admins (including those
who also play) land on `/admin` after signing in; an admin account without a
player profile that tries to open `/account` is pointed to `/admin`.

The navbar shows `login` to visitors. Once signed in it becomes an account
menu (the person icon; a flat list in the mobile menu) with `profile` for
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
`npm run format:check` clean. [Husky](https://typicode.github.io/husky/) git
hooks (installed by `npm install`) enforce this: `pre-commit` runs ESLint and
Prettier on staged files via lint-staged, and `pre-push` runs
`format:check`, `lint`, `check` and `test`. Bypass in an emergency with
`--no-verify`. Unit tests sit next to the code they cover
(`src/data/*.test.ts`, `src/lib/*.test.ts`) and build their records with the
helpers in `src/test/fixtures.ts`.

## 🔭 Roadmap

Competition data and editorial copy are live and editable from `/admin`.
