// Kept apart from `admin.ts` so player-side writes (e.g. `shop.ts`) can map
// constraint violations without loading the admin module.

/** The name of the Postgres constraint a write violated, if any. */
export function violatedConstraint(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object";) {
    const { constraint } = e as { constraint?: string };
    if (constraint) return constraint;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
