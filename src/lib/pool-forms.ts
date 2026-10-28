import { z } from "astro/zod";
import {
  formValues,
  parseWith,
  slugify,
  type ParseResult,
} from "./admin-forms";
import { POOL_TEAM_SIZE } from "./pool-bracket";

// Validation for the admin pool bracket forms (see `admin-forms.ts`).

const poolTeamSchema = z.object({
  id: z.string().min(1, "Give the team a name with letters or numbers."),
  name: z
    .string()
    .trim()
    .min(1, "Required.")
    .max(80, "Keep it under 80 characters."),
  memberIds: z
    .array(z.string().min(1))
    .length(POOL_TEAM_SIZE, `Pick ${POOL_TEAM_SIZE} different players.`),
});

export type PoolTeamInput = z.output<typeof poolTeamSchema>;

export function parsePoolTeamForm(form: FormData): ParseResult<PoolTeamInput> {
  const values = formValues(form);
  const memberIds = [
    ...new Set(
      [values.playerOne, values.playerTwo].filter(
        (v): v is string => typeof v === "string" && v !== "",
      ),
    ),
  ];
  return parseWith(
    poolTeamSchema,
    {
      id: slugify(values.name ?? ""),
      name: values.name ?? "",
      memberIds,
    },
    values,
  );
}

const weekNumber = z.coerce
  .number({ error: "Enter a whole number." })
  .int("Enter a whole number.")
  .min(1, "Weeks start at 1.")
  .max(99, "That's too high.");

export function parsePoolWeek(value: string | undefined): number | undefined {
  const parsed = weekNumber.safeParse(value ?? "");
  return parsed.success ? parsed.data : undefined;
}

const resultSchema = z.object({
  round: z.coerce.number().int().min(0).max(4),
  matchIndex: z.coerce.number().int().min(0).max(7),
  winnerTeamId: z.string().min(1),
});

/** A match result (or the match to clear), or `undefined` if malformed. */
export function parsePoolResultForm(
  form: FormData,
): z.output<typeof resultSchema> | undefined {
  const values = formValues(form);
  const parsed = resultSchema.safeParse({
    round: values.round ?? "",
    matchIndex: values.matchIndex ?? "",
    winnerTeamId: values.winnerTeamId ?? "",
  });
  return parsed.success ? parsed.data : undefined;
}
