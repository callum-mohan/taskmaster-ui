---
name: taskmaster-component-standards
description: >-
  Coding standards and architecture conventions for EAYL Taskmaster Astro UI.
  Use when creating or editing Astro components, pages, TypeScript types, or
  the data layer so new code matches the established patterns: typed
  `Props`, the data-layer separation (schema → data → derived queries → UI),
  per-request Neon Postgres data rules, the admin area (auth + writes),
  prop-driven reusable components, client scripts, and accessibility. Triggers: "add a component", "create a page",
  "add data", "wire up data", "new type", "follow the project conventions".
---

# Taskmaster Component & Code Standards

The UI is **Astro + TypeScript + Tailwind v4**, **no React**, rendered on
request on **Cloudflare Workers** (`output: "server"`). Competition data lives
in **Neon Postgres** (Drizzle ORM over Neon's HTTP driver) and is read **per
request**, so edits made in `/admin` show up immediately. The goal is a clean,
prop-driven component set backed by a database-agnostic data layer.

## Architecture: strict data-layer separation
Data flows one direction. Keep every layer in its place:

```
src/db/schema.ts        ← Drizzle tables (raw facts only)
src/types/index.ts      ← shape definitions (interfaces, unions)
src/data/competition.ts ← load every table per request (one db.batch)
src/data/*.ts           ← pure mappers: rows → raw records (types)
src/data/queries.ts     ← createQueries(data): derived selectors / view models
src/middleware.ts       ← Astro.locals.getQueries() (lazy, once per request)
pages (.astro)          ← await getQueries(), pass plain props to components
components (.astro)      ← render props only; NO data imports of raw records
```

Rules:
- **Never hard-code player/task/score data inside a component.** Components
  receive everything through typed `Props`.
- Pages get selectors with
  `const { getLeaderboard } = await Astro.locals.getQueries();`, then hand
  ready-to-render data to components. Never cache competition data in
  module-level state: a Worker isolate serves many requests concurrently.
- All cross-record computation (leaderboard ranking, stats, recent results,
  initials) lives in `queries.ts` as pure functions — not in components or
  page markup.
- This separation keeps the database out of the UI: only `src/data/*.ts`
  imports `src/db`, and **no component, page or client script may import
  `src/db`**. Admin writes live in `src/data/admin.ts`. Preserve it.

## Types (`src/types/index.ts`)
- Define a shared `interface` / union for every domain concept and reuse it;
  don't inline object shapes.
- Separate **raw records** (`Player`, `Task`, `Score`) from **derived view
  models** (`LeaderboardRow`, `TaskResult`, `CompetitionStats`).
- Dates are ISO 8601 strings on the record; format them at the page level.
- Status is a string-literal union (`"upcoming" | "live" | "completed"`),
  exported as `TaskStatus`.

## Data (`src/db/*`, `src/data/*.ts`)
- The schema lives in `src/db/schema.ts`. Change it, then
  `npm run db:generate`; never hand-edit or ad-hoc migrate the database.
  Test migrations on a Neon branch (`neon checkout dev --create`) first.
- Store **facts only** (points, dates, membership). Derive positions, status
  and totals in `src/data/*` / `queries.ts` so they can't drift.
- One mapper file per entity: `players.ts`, `teams.ts`, `tasks.ts`,
  `scores.ts`. Each maps rows to the `src/types` shape (omit `null` columns
  rather than passing `null`). `competition.ts` does the loading; add new
  tables to its `db.batch` so a page view stays one round trip.
- Lookups (`getXById`, `getCurrent*`) live inside `createQueries`, keeping
  selectors synchronous over the snapshot.
- Dynamic routes have no `getStaticPaths`: look the param up and
  `return Astro.rewrite("/404")` when it's missing.
- New initial/demo rows go in `db/seed-data.ts` (seeded with `npm run db:seed`,
  insert-only). Editorial copy (recaps, changelog) is data too: it lives in
  the `recaps` / `changelog_entries` tables, edited in `/admin`.
- Bonuses earned automatically (poll votes, People's Choice, predictions) are
  derived in `competition.ts` from their votes/results, never stored, so they
  can't go stale.

## Astro component conventions
- **Typed props:** every component declares `interface Props { ... }` and
  destructures from `Astro.props`, with sensible defaults.
- **Pass-through styling:** accept an optional `class?: string` prop and merge
  it last so callers can extend layout (e.g. `class="shrink-0"`).
- Use `class:list={[...]}` for conditional/variant classes, not string
  concatenation.
- Keep components **small, single-purpose, and reusable**. Prefer composing
  (e.g. `TerminalWindow` wrapping content) over duplicating markup.
- Map variants with a typed config object keyed by the union
  (see `TaskStatusBadge.astro`'s `config: Record<TaskStatus, {...}>`), rather
  than chains of `if`/ternaries in markup.
- Comment only where it adds context (e.g. explaining the server-rendered
  countdown fallback); don't narrate obvious markup.

## Admin area (`/admin`)
- Auth is Neon Auth (Managed Better Auth) through the small adapter in
  `src/lib/auth.ts`. Everyone signs in at `/login` (`/admin/login` is a
  legacy redirect). `src/middleware.ts` guards every `/admin` path and sets
  `Astro.locals.admin`; only the `admin` role gets in.
- Admin pages render with `AdminLayout.astro` (the site `Layout` plus an
  admin sub-nav) and the `src/components/admin/*` controls (`AdminField`,
  `ScoreGrid`, `ConfirmDelete`, `Notice`, shared class strings in
  `styles.ts`). Admin areas are defined once in `src/lib/admin-nav.ts`
  (sub-nav, dashboard, command palette): dashboard · weeks · roster · site ·
  guide. Prefer extending an existing area over adding a new one, and give
  each job one screen: don't add a second place to do the same thing.
- Anything about a single week is a tab of its workspace,
  `/admin/weeks/[id]/…` (brief · judge · results night · recap), rendered
  with `WeekHeader` and linked with `weekHref(id, step)`. A week's step
  states come from `getWeekProgress` (`src/data/week-progress.ts`); update it
  (and its tests) when a step's meaning changes.
- When an admin URL moves, add the old path to `legacyAdminPath` in
  `admin-nav.ts` so bookmarks redirect, and update `/admin/guide` and the
  README when an admin workflow changes.
- Public detail pages show an `AdminEditLink` to their editor when
  `viewer.isAdmin`.
- Forms are plain `method="post"` forms handled in the page frontmatter: parse
  with `src/lib/admin-forms.ts` (zod), write with `src/data/admin.ts`, then
  `Astro.redirect` (post/redirect/get). On failure, re-render with the
  submitted `values` and per-field `errors`; map constraint errors with
  `describeWriteError`. Use a hidden `intent` field for multiple actions.
- Multi-statement writes go in one `db.batch([...])` (a transaction).
- Deletes always go through `ConfirmDelete` and show what cascades.
- Ids are immutable after create (they're public URLs).

## Client-side JavaScript
- Default to server-rendered HTML that works without JS. Add a `<script>` only when behaviour needs the
  browser (e.g. `Countdown.astro`, mobile nav toggle).
- Scripts are TypeScript, type the DOM queries (`querySelector<HTMLElement>`),
  and must **degrade gracefully**: render a correct server-side value first,
  then enhance (the countdown prints a valid time before JS runs).
- Drive scripts off `data-*` attributes rather than hard-coded values.

## Accessibility (required)
- Semantic HTML and correct heading hierarchy (`h1` once per page, sections
  use `h2`).
- Decorative chrome (traffic lights, `●`, medals used only as decoration) is
  `aria-hidden="true"`; meaningful state is also conveyed in text.
- Interactive elements are real `<a>`/`<button>` with visible focus (global
  `:focus-visible` outline) and proper `aria-*` (`aria-current="page"` for
  active nav, `aria-expanded`/`aria-controls` for the menu toggle).
- Provide a skip-to-content link (in `Layout.astro`); don't remove it.

## Responsive
- Mobile-first: base styles target small screens, scale up with `sm:`/`lg:`.
- Don't just shrink desktop — collapse multi-column grids
  (`grid lg:grid-cols-2`) and swap the desktop nav for the mobile menu.

## Validation before finishing
Always run and keep clean:
```
npx astro check   # 0 errors / 0 warnings
npx astro build
```
Also confirm nav links and dynamic routes resolve (unknown ids → 404), and
that no section looks unfinished or contains placeholder content. Test admin
changes against the Neon `dev` branch, never production.

## Don't
- ❌ Add React or UI libraries without a strong technical reason.
- ❌ Query the database from the browser or a client script, or expose admin
  writes outside the guarded `/admin` routes.
- ❌ Hold competition data in module-level variables (requests share an
  isolate); load it through `Astro.locals.getQueries()`.
- ❌ Import raw data arrays into components or compute standings in markup.
- ❌ Leave untyped props or inline one-off object shapes.
