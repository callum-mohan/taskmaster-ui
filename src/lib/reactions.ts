import type { ReactionKind } from "../types";

/** The reaction buttons under gallery entries, in display order. */
export const REACTIONS: Record<ReactionKind, { emoji: string; label: string }> =
  {
    laugh: { emoji: "😂", label: "funny" },
    fire: { emoji: "🔥", label: "fire" },
    clap: { emoji: "👏", label: "applause" },
    mind_blown: { emoji: "🤯", label: "mind blown" },
    egg: { emoji: "🥚", label: "egg-cellent" },
  };

export const REACTION_KINDS = Object.keys(REACTIONS) as ReactionKind[];

export const isReactionKind = (value: unknown): value is ReactionKind =>
  typeof value === "string" && value in REACTIONS;
