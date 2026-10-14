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
  admin sign-in, via `@neondatabase/auth`
- Prettier (with `prettier-plugin-astro`)

## 📁 Project structure

```text
db/
├── seed.ts            # `npm run db:seed` — inserts missing initial rows
└── seed-data.ts       # initial data (generated from the original mock data)
drizzle/               # generated SQL migrations (`npm run db:generate`)
scripts/
└── create-admin.mjs   # `npm run admin:create` — bootstrap an admin account
src/
├── middleware.ts      # per-request data loader + /admin auth guard
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
│   ├── scores.ts      # rows → Score  ─┘  (points → positions; bonus points)
│   ├── queries.ts     # createQueries(data) — derived selectors (the UI's API)
│   ├── admin.ts       # admin reads/writes (one transaction per save)
│   └── recaps.ts      # editorial recap copy (TypeScript)
├── lib/
│   ├── auth.ts        # Neon Auth adapter for Astro (sign in/out, session)
│   └── admin-forms.ts # admin form parsing + validation (zod)
├── pages/
│   ├── admin/                 # /admin — sign-in, dashboard, CRUD, scores
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
- `NEON_AUTH_BASE_URL` — the branch's Neon Auth URL (admin sign-in).

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

**Recording results:** use the [admin area](#-admin). Changes are live
immediately; there's nothing to rebuild.

## 🔐 Admin

`/admin` lets signed-in admins create, edit and delete players, teams (and
their members) and tasks, enter a week's scores in one grid, and record bonus
points or deductions. Deletes ask for confirmation and list what else will be
removed. Forms are plain HTML posts, so they work without JavaScript.

- Sign-in uses Neon Auth (email + password). Only users with the `admin` role
  get in; others are signed in but shown "no access".
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

1. In Cloudflare, add `www.eayltaskmaster.com` as a **Custom Domain** on the
   `taskmaster-ui` Worker, and point DNS away from GitHub Pages.
2. Disable GitHub Pages for the repository.
3. If you also use the `*.workers.dev` URL, add it as a trusted domain:
   `neon neon-auth domain add https://<name>.workers.dev --branch production`
   (`https://www.eayltaskmaster.com` is already trusted).

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

| Command                | Action                                   |
| :--------------------- | :--------------------------------------- |
| `npm install`          | Install dependencies                     |
| `npm run dev`          | Start the dev server at `localhost:4321` |
| `npm run build`        | Build the production site to `./dist/`   |
| `npm run preview`      | Preview the production build locally     |
| `npm run deploy`       | Build and deploy to Cloudflare Workers   |
| `npm run admin:create` | Create an admin account (see Admin)      |
| `npm run check`        | Type-check + diagnostics (`astro check`) |
| `npm run format`       | Format the codebase with Prettier        |
| `npm run format:check` | Check formatting without writing changes |
| `npm run db:check`     | Run a test query against `DATABASE_URL`  |
| `npm run db:generate`  | Generate a SQL migration from the schema |
| `npm run db:migrate`   | Apply pending migrations (direct URL)    |
| `npm run db:seed`      | Insert missing initial data (idempotent) |
| `npm run db:studio`    | Browse and edit data in Drizzle Studio   |

Before committing, keep `npm run check` and `npm run format:check` clean.

## 🔭 Roadmap

Competition data is live and editable from `/admin`. Next steps: recaps in
the database and player submissions.
