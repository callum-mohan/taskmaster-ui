# EAYL Taskmaster

The frontend for a **Taskmaster-style competition** run by the Engineering
Academy. Every Friday a new task is released; players have one week to complete
it, earn points, and climb the leaderboard. ~25 players, 16 weeks, one winner.

The UI has a deliberate **terminal / CRT aesthetic** — monospace, green-on-black,
window chrome — and is built static-first with **Astro + TypeScript + Tailwind v4**.

> The site currently runs on **mock data only**. There is no backend, auth or
> database yet — the data layer is structured so it can later be swapped for
> Supabase without touching the UI.

## 🚀 Tech stack

- [Astro](https://astro.build) (static output, no UI framework)
- TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`), with design tokens in
  [`src/styles/global.css`](src/styles/global.css)
- [`@astrojs/sitemap`](https://docs.astro.build/en/guides/integrations-guide/sitemap/)
  for an auto-generated sitemap (+ `public/robots.txt`)
- Prettier (with `prettier-plugin-astro`)

## 📁 Project structure

```text
src/
├── components/        # Reusable, prop-driven .astro components
├── layouts/
│   └── Layout.astro   # <head>, nav, footer, skip link
├── data/              # Mock data + the data-access layer
│   ├── players.ts     # raw records ─┐
│   ├── tasks.ts       # raw records  ├─ become Supabase queries later
│   ├── scores.ts      # raw records ─┘  (weekly scores + bonus points/deductions)
│   └── queries.ts     # derived selectors / view models (the UI's single API)
├── pages/
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
types/index.ts   →   data/*.ts        →   data/queries.ts   →   pages      →   components
(shapes)             (raw mock records)   (derived selectors)   (fetch data)   (render props)
```

- **Components never import raw records** and never compute standings — they
  render typed `Props` only.
- **Pages** call selectors from [`src/data/queries.ts`](src/data/queries.ts)
  and pass ready-to-render data down.
- All cross-record computation (leaderboard ranking, rank movement, awards,
  head-to-head) lives in `queries.ts` as pure functions.

This is the seam for a future backend: re-implement the selectors in
`queries.ts` against Supabase and the components stay unchanged.

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
| `npm run check`        | Type-check + diagnostics (`astro check`) |
| `npm run format`       | Format the codebase with Prettier        |
| `npm run format:check` | Check formatting without writing changes |

Before committing, keep `npm run check` and `npm run format:check` clean.

## 🔭 Roadmap

The mock-data arrays in `src/data/` are the integration point for a real
backend (Supabase). Replacing them — and the selectors in `queries.ts` — is the
planned path to live data, auth and submissions.
