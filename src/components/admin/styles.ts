// Shared class strings for the admin forms, so every admin page uses the
// same terminal-styled controls (see the `btnPrimary` / `btnGhost` pattern
// on the public pages).

import type { WeekStepState } from "../../types";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md border border-acid bg-acid/10 px-4 py-2 text-xs font-bold tracking-widest text-acid transition-colors hover:bg-acid hover:text-term-bg";

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-md border border-grid px-4 py-2 text-xs font-bold tracking-widest text-ink-dim transition-colors hover:border-ink-faint hover:text-ink";

export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-md border border-danger/60 bg-danger/10 px-4 py-2 text-xs font-bold tracking-widest text-danger transition-colors hover:bg-danger hover:text-term-bg";

/** A square, icon-only control (pair it with an accessible name). */
export const btnIcon =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-grid text-ink-dim transition-colors hover:border-ink-faint hover:text-ink";

export const inputBase =
  "w-full rounded-md border bg-term-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-acid";

export const inputClass = (invalid: boolean) =>
  `${inputBase} ${invalid ? "border-danger" : "border-grid"}`;

export const labelClass =
  "block text-[11px] font-bold uppercase tracking-[0.2em] text-ink-faint";

export const tableHead =
  "border-b border-grid px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint";

export const tableCell = "border-b border-grid/60 px-3 py-2 align-middle";

/** How each week-step state looks, with a text label so colour isn't the only signal. */
export const weekStepState: Record<
  WeekStepState,
  { icon: string; label: string; class: string }
> = {
  done: { icon: "✓", label: "done", class: "border-acid/40 text-acid" },
  active: {
    icon: "●",
    label: "needs doing",
    class: "border-amber/60 text-amber",
  },
  waiting: { icon: "○", label: "not yet", class: "border-grid text-ink-faint" },
  optional: {
    icon: "–",
    label: "nothing required",
    class: "border-grid text-ink-dim",
  },
};
