import { z } from "astro/zod";
import type { PollRecord } from "../data/admin";

// Validation for the admin forms. Each parser takes the submitted FormData
// and returns either typed input for `src/data/admin.ts` or per-field error
// messages plus the raw values, so a rejected form can be re-rendered as the
// admin typed it.

export type FormValues = Record<string, string>;
export type FieldErrors = Record<string, string>;

export type ParseResult<T> = { values: FormValues } & (
  { ok: true; data: T } | { ok: false; errors: FieldErrors }
);

/** Raw string values from a form (first value per name). */
export function formValues(form: FormData): FormValues {
  const values: FormValues = {};
  for (const [key, value] of form) {
    if (typeof value === "string" && !(key in values)) values[key] = value;
  }
  return values;
}

export function parseWith<T>(
  schema: z.ZodType<T>,
  input: unknown,
  values: FormValues,
): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data, values };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors, values };
}

/** Lowercase, dash-separated id safe for URLs (e.g. "team-friendship"). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const slug = z
  .string()
  .trim()
  .min(1, "Required.")
  .max(60, "Keep it under 60 characters.")
  // Underscores are allowed because some existing ids use them.
  .regex(
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/,
    "Use lowercase letters and numbers, separated by single dashes.",
  );

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required.")
    .max(max, `Keep it under ${max} characters.`);

/** Blank → null, otherwise trimmed text. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** Blank → undefined (leave unchanged / append), otherwise a whole number. */
const optionalOrder = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : Number(v)))
  .pipe(
    z
      .number({ error: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(0, "Must be 0 or more.")
      .optional(),
  );

const integer = (message = "Enter a whole number.") =>
  z
    .string()
    .trim()
    .min(1, "Required.")
    .transform(Number)
    .pipe(
      z
        .number({ error: message })
        .int(message)
        .min(-10000, "That's too low.")
        .max(10000, "That's too high."),
    );

// ── Players ───────────────────────────────────────────────────────────

// Shared with the player self-service form (`account-forms.ts`).
export const bioField = optionalText(500);
export const avatarUrlField = optionalText(500).refine(
  (v) => v === null || /^(https:\/\/|\/)\S+$/.test(v),
  "Use an https:// URL or a site path starting with /.",
);

const playerSchema = z.object({
  id: slug,
  name: requiredText(80),
  bio: bioField,
  avatarUrl: avatarUrlField,
  sortOrder: optionalOrder,
});

export type PlayerInput = z.output<typeof playerSchema>;

export function parsePlayerForm(form: FormData): ParseResult<PlayerInput> {
  const values = formValues(form);
  return parseWith(
    playerSchema,
    {
      id: values.id ?? "",
      name: values.name ?? "",
      bio: values.bio ?? "",
      avatarUrl: values.avatarUrl ?? "",
      sortOrder: values.sortOrder ?? "",
    },
    values,
  );
}

const playerEmailSchema = z.object({
  // Blank withdraws the invite.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Keep it under 254 characters.")
    .refine((v) => v === "" || z.email().safeParse(v).success, {
      message: "Enter a valid email address.",
    })
    .transform((v) => (v === "" ? null : v)),
});

export type PlayerEmailInput = z.output<typeof playerEmailSchema>;

export function parsePlayerEmailForm(
  form: FormData,
): ParseResult<PlayerEmailInput> {
  const values = formValues(form);
  return parseWith(playerEmailSchema, { email: values.email ?? "" }, values);
}

// ── Teams ─────────────────────────────────────────────────────────────

const teamSchema = z.object({
  id: slug,
  name: requiredText(80),
  tagline: optionalText(160),
  sortOrder: optionalOrder,
  memberIds: z.array(slug),
});

export type TeamInput = z.output<typeof teamSchema>;

export function parseTeamForm(form: FormData): ParseResult<TeamInput> {
  const values = formValues(form);
  const memberIds = form
    .getAll("memberIds")
    .filter((v): v is string => typeof v === "string");
  return parseWith(
    teamSchema,
    {
      id: values.id ?? "",
      name: values.name ?? "",
      tagline: values.tagline ?? "",
      sortOrder: values.sortOrder ?? "",
      memberIds: [...new Set(memberIds)],
    },
    { ...values, memberIds: memberIds.join(",") },
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────

/** `<input type="datetime-local">` value → Postgres wall-clock timestamp. */
const localDateTime = z
  .string()
  .trim()
  .min(1, "Required.")
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Enter a date and time.")
  .transform((v) => {
    const [date, time] = v.split("T");
    return `${date} ${time.length === 5 ? `${time}:00` : time}`;
  });

const taskSchema = z
  .object({
    id: slug,
    weekNumber: z
      .string()
      .trim()
      .min(1, "Required.")
      .transform(Number)
      .pipe(
        z
          .number({ error: "Enter a week number." })
          .int("Enter a whole number.")
          .min(1, "Weeks start at 1.")
          .max(99, "Keep it under 100."),
      ),
    title: requiredText(120),
    description: z.string().trim().max(1000, "Keep it under 1000 characters."),
    briefMode: z.enum(["prose", "bullets"]),
    brief: z.string().max(5000, "Keep it under 5000 characters."),
    releaseDate: localDateTime,
    deadline: localDateTime,
    format: z.enum(["individual", "team"], { error: "Pick a format." }),
  })
  .refine((t) => t.deadline > t.releaseDate, {
    path: ["deadline"],
    message: "The deadline must be after the release date.",
  })
  .transform(({ briefMode, brief, ...task }) => {
    const text = brief.trim();
    const bullets = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean);
    return {
      ...task,
      brief:
        text === ""
          ? null
          : briefMode === "bullets"
            ? bullets
            : text.replace(/\r\n/g, "\n"),
    };
  });

export type TaskInput = z.output<typeof taskSchema>;

export function parseTaskForm(form: FormData): ParseResult<TaskInput> {
  const values = formValues(form);
  return parseWith(
    taskSchema,
    {
      id: values.id ?? "",
      weekNumber: values.weekNumber ?? "",
      title: values.title ?? "",
      description: values.description ?? "",
      briefMode: values.briefMode ?? "prose",
      brief: values.brief ?? "",
      releaseDate: values.releaseDate ?? "",
      deadline: values.deadline ?? "",
      format: values.format ?? "",
    },
    values,
  );
}

/** Postgres wall-clock timestamp → `<input type="datetime-local">` value. */
export function toDateTimeLocal(timestamp: string): string {
  return timestamp.replace(" ", "T").slice(0, 16);
}

// ── Scores ────────────────────────────────────────────────────────────

export interface TaskScoreInput {
  playerId: string;
  points: number;
  comment: string | null;
}

export interface TeamScoreInput {
  teamId: string;
  points: number;
}

/** Field names used by the score grid for a given row id. */
export const scoreField = {
  points: (id: string) => `points:${id}`,
  comment: (id: string) => `comment:${id}`,
};

const optionalPoints = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(
    z
      .number({ error: "Enter a whole number." })
      .int("Enter a whole number.")
      .min(-10000, "That's too low.")
      .max(10000, "That's too high.")
      .nullable(),
  );

/**
 * Parses the per-week grid. A blank points cell means "not scored" and is
 * dropped; a comment without points is rejected so nothing is silently lost.
 */
export function parseTaskScoresForm(
  form: FormData,
  playerIds: string[],
): ParseResult<TaskScoreInput[]> {
  const values = formValues(form);
  const errors: FieldErrors = {};
  const data: TaskScoreInput[] = [];
  for (const playerId of playerIds) {
    const pointsKey = scoreField.points(playerId);
    const commentKey = scoreField.comment(playerId);
    const points = optionalPoints.safeParse(values[pointsKey] ?? "");
    const comment = optionalText(500).safeParse(values[commentKey] ?? "");
    if (!points.success) {
      errors[pointsKey] = points.error.issues[0].message;
      continue;
    }
    if (!comment.success) {
      errors[commentKey] = comment.error.issues[0].message;
      continue;
    }
    if (points.data === null) {
      if (comment.data !== null)
        errors[pointsKey] = "Add points for this note.";
      continue;
    }
    data.push({ playerId, points: points.data, comment: comment.data });
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors, values }
    : { ok: true, data, values };
}

export function parseTeamScoresForm(
  form: FormData,
  teamIds: string[],
): ParseResult<TeamScoreInput[]> {
  const values = formValues(form);
  const errors: FieldErrors = {};
  const data: TeamScoreInput[] = [];
  for (const teamId of teamIds) {
    const key = scoreField.points(teamId);
    const points = optionalPoints.safeParse(values[key] ?? "");
    if (!points.success) errors[key] = points.error.issues[0].message;
    else if (points.data !== null) data.push({ teamId, points: points.data });
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors, values }
    : { ok: true, data, values };
}

// ── Bonus points ──────────────────────────────────────────────────────

const bonusSchema = z.object({
  playerId: slug.refine(Boolean, "Pick a player."),
  points: integer().refine((n) => n !== 0, "Use a non-zero amount."),
  reason: requiredText(200),
});

export type BonusInput = z.output<typeof bonusSchema>;

export function parseBonusForm(form: FormData): ParseResult<BonusInput> {
  const values = formValues(form);
  return parseWith(
    bonusSchema,
    {
      playerId: values.playerId ?? "",
      points: values.points ?? "",
      reason: values.reason ?? "",
    },
    values,
  );
}

/** Parses a positive integer id from a hidden form field. */
export function parseRowId(form: FormData, name = "rowId"): number | undefined {
  const n = Number(form.get(name));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// ── Polls ─────────────────────────────────────────────────────────────

export const MAX_POLL_OPTIONS = 40;
/** Blank option rows a new poll form starts with. */
export const NEW_POLL_OPTION_ROWS = 4;

/** Field names for the repeatable option rows of the poll form. */
export const pollOptionField = {
  rows: "optionRows",
  id: (i: number) => `option-id-${i}`,
  label: (i: number) => `option-label-${i}`,
};

export interface PollOptionInput {
  /** Set for an existing option (keeps its votes); absent for a new one. */
  id?: number;
  label: string;
}

const choiceCount = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(
      z
        .number({ error: "Enter a whole number." })
        .int("Enter a whole number.")
        .min(1, `${label} must be at least 1.`)
        .max(MAX_POLL_OPTIONS, `There can't be more than ${MAX_POLL_OPTIONS}.`)
        .nullable(),
    );

const pollSchema = z
  .object({
    id: slug,
    question: requiredText(200),
    description: optionalText(1000),
    kind: z.enum(["single", "multiple"], { error: "Pick a poll type." }),
    minChoices: choiceCount("The minimum"),
    maxChoices: choiceCount("The maximum"),
    opensAt: localDateTime,
    closesAt: localDateTime,
    resultsVisibility: z.enum(
      ["always", "after_vote", "after_close", "admin_only"],
      { error: "Pick when results are shown." },
    ),
    allowVoteChange: z.boolean(),
    anonymous: z.boolean(),
    showOnHomeDays: z
      .string()
      .trim()
      .min(1, "Required.")
      .transform(Number)
      .pipe(
        z
          .number({ error: "Enter a whole number of days." })
          .int("Enter a whole number of days.")
          .min(0, "Must be 0 or more.")
          .max(365, "Keep it within a year."),
      ),
    published: z.boolean(),
    voteBonusPoints: z
      .string()
      .trim()
      .min(1, "Required.")
      .transform(Number)
      .pipe(
        z
          .number({ error: "Enter a whole number of points." })
          .int("Enter a whole number of points.")
          .min(0, "Must be 0 or more.")
          .max(100, "Keep it to 100 or fewer."),
      ),
    // Blank → null: the week live when the poll opens.
    bonusTaskId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((p) => p.closesAt > p.opensAt, {
    path: ["closesAt"],
    message: "The poll must close after it opens.",
  })
  .refine((p) => p.kind === "single" || p.minChoices !== null, {
    path: ["minChoices"],
    message: "Required for multiple choice.",
  })
  .refine(
    (p) =>
      p.kind === "single" ||
      p.maxChoices === null ||
      p.maxChoices >= (p.minChoices ?? 1),
    {
      path: ["maxChoices"],
      message: "The maximum can't be below the minimum.",
    },
  )
  .transform((p) =>
    p.kind === "single"
      ? { ...p, minChoices: 1, maxChoices: 1 }
      : { ...p, minChoices: p.minChoices ?? 1 },
  );

export type PollInput = z.output<typeof pollSchema> & {
  options: PollOptionInput[];
};

/** How many option rows the submitted form had (bounded). */
function optionRowCount(values: FormValues): number {
  const n = Number(values[pollOptionField.rows]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_POLL_OPTIONS * 2) : 0;
}

/**
 * Reads the option rows. Blank rows are dropped (so clearing an existing
 * option removes it); duplicate labels are rejected.
 */
function parsePollOptions(values: FormValues, errors: FieldErrors) {
  const options: PollOptionInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < optionRowCount(values); i++) {
    const label = (values[pollOptionField.label(i)] ?? "").trim();
    if (label === "") continue;
    const key = pollOptionField.label(i);
    if (label.length > 120) {
      errors[key] = "Keep it under 120 characters.";
      continue;
    }
    const normalised = label.toLowerCase();
    if (seen.has(normalised)) {
      errors[key] = "This option is listed twice.";
      continue;
    }
    seen.add(normalised);
    const id = Number(values[pollOptionField.id(i)]);
    options.push({
      ...(Number.isInteger(id) && id > 0 && { id }),
      label,
    });
  }
  if (options.length < 2) errors.options = "Add at least two options.";
  if (options.length > MAX_POLL_OPTIONS) {
    errors.options = `Keep it to ${MAX_POLL_OPTIONS} options or fewer.`;
  }
  return options;
}

export function parsePollForm(form: FormData): ParseResult<PollInput> {
  const values = formValues(form);
  const parsed = parseWith(
    pollSchema,
    {
      id: values.id ?? "",
      question: values.question ?? "",
      description: values.description ?? "",
      kind: values.kind ?? "",
      minChoices: values.minChoices ?? "",
      maxChoices: values.maxChoices ?? "",
      opensAt: values.opensAt ?? "",
      closesAt: values.closesAt ?? "",
      resultsVisibility: values.resultsVisibility ?? "",
      allowVoteChange: values.allowVoteChange === "on",
      anonymous: values.voters !== "public",
      showOnHomeDays: values.showOnHomeDays ?? "",
      published: values.published === "on",
      voteBonusPoints: values.voteBonusPoints ?? "",
      bonusTaskId: values.bonusTaskId ?? "",
    },
    values,
  );
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const options = parsePollOptions(values, errors);
  if (parsed.ok && parsed.data.kind === "multiple") {
    const { minChoices, maxChoices } = parsed.data;
    if (minChoices > options.length) {
      errors.minChoices ??= `There are only ${options.length} options.`;
    }
    if (maxChoices !== null && maxChoices > options.length) {
      errors.maxChoices ??= `There are only ${options.length} options.`;
    }
  }
  if (!parsed.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors, values };
  }
  return { ok: true, data: { ...parsed.data, options }, values };
}

/** Option rows of a poll form as `{ id, label }` pairs (blank rows kept). */
export function pollOptionRows(
  values: FormValues,
): { id: string; label: string }[] {
  return Array.from({ length: optionRowCount(values) }, (_, i) => ({
    id: values[pollOptionField.id(i)] ?? "",
    label: values[pollOptionField.label(i)] ?? "",
  }));
}

/** Writes option rows back into form values, replacing the old rows. */
export function withPollOptionRows(
  values: FormValues,
  rows: { id: string; label: string }[],
): FormValues {
  const next: FormValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^option-(?:id|label)-\d+$/.test(key)) next[key] = value;
  }
  rows.forEach((row, i) => {
    next[pollOptionField.id(i)] = row.id;
    next[pollOptionField.label(i)] = row.label;
  });
  next[pollOptionField.rows] = String(rows.length);
  return next;
}

/**
 * Re-renders the poll form with extra option rows: the given labels (e.g.
 * every player) fill blank rows first and skip any already listed, or with
 * no labels, a few blank rows are added. Capped at `MAX_POLL_OPTIONS`.
 */
export function addPollOptionRows(
  values: FormValues,
  labels: string[] = [],
): FormValues {
  const rows = pollOptionRows(values);
  const listed = new Set(rows.map((r) => r.label.trim().toLowerCase()));
  const queue = labels.filter((l) => !listed.has(l.trim().toLowerCase()));
  if (labels.length === 0) {
    queue.push(...Array<string>(NEW_POLL_OPTION_ROWS).fill(""));
  }
  for (const row of rows) {
    if (queue.length > 0 && row.id === "" && row.label.trim() === "") {
      row.label = queue.shift()!;
    }
  }
  const room = Math.max(0, MAX_POLL_OPTIONS - rows.length);
  for (const label of queue.slice(0, room)) rows.push({ id: "", label });
  return withPollOptionRows(values, rows);
}

/**
 * The runtime's current wall-clock time as a Postgres timestamp. Stored
 * times are zone-less and read back in the runtime's local zone, so "now"
 * must be expressed the same way.
 */
export function wallClockNow(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Initial form values for a new poll: opens now, closes in a week. */
export function newPollFormValues(): FormValues {
  return withPollOptionRows(
    {
      kind: "single",
      minChoices: "",
      maxChoices: "",
      opensAt: toDateTimeLocal(wallClockNow()),
      closesAt: toDateTimeLocal(wallClockNow(7 * 24 * 60 * 60 * 1000)),
      showOnHomeDays: "3",
      resultsVisibility: "after_vote",
      voters: "anonymous",
      allowVoteChange: "on",
      published: "on",
      voteBonusPoints: "1",
      bonusTaskId: "",
    },
    Array.from({ length: NEW_POLL_OPTION_ROWS }, () => ({ id: "", label: "" })),
  );
}

/**
 * Form values for a stored poll. With `copy`, it's a fresh poll prefilled
 * from this one (no id, new dates, options not linked to the original).
 */
export function pollFormValues(poll: PollRecord, copy = false): FormValues {
  const base: FormValues = {
    id: copy ? "" : poll.id,
    question: poll.question,
    description: poll.description ?? "",
    kind: poll.kind,
    minChoices: poll.kind === "multiple" ? String(poll.minChoices) : "",
    maxChoices:
      poll.kind === "multiple" && poll.maxChoices !== null
        ? String(poll.maxChoices)
        : "",
    opensAt: toDateTimeLocal(poll.opensAt),
    closesAt: toDateTimeLocal(poll.closesAt),
    showOnHomeDays: String(poll.showOnHomeDays),
    resultsVisibility: poll.resultsVisibility,
    voters: poll.anonymous ? "anonymous" : "public",
    allowVoteChange: poll.allowVoteChange ? "on" : "",
    published: poll.published ? "on" : "",
    voteBonusPoints: String(poll.voteBonusPoints),
    // A copy gets new dates, so let its week follow them.
    bonusTaskId: copy ? "" : (poll.bonusTaskId ?? ""),
  };
  const rows = poll.options.map((o) => ({
    id: copy ? "" : String(o.id),
    label: o.label,
  }));
  if (copy) {
    const fresh = newPollFormValues();
    base.opensAt = fresh.opensAt;
    base.closesAt = fresh.closesAt;
  }
  return withPollOptionRows(base, rows);
}

/**
 * Handles the poll form's "+ more rows / every player / every team"
 * buttons, which re-render the form instead of saving it.
 */
export function applyPollPreset(
  values: FormValues,
  preset: string,
  names: { players: string[]; teams: string[] },
): FormValues {
  if (preset === "players") return addPollOptionRows(values, names.players);
  if (preset === "teams") return addPollOptionRows(values, names.teams);
  return addPollOptionRows(values);
}

/** Week labels for the poll form's bonus-week picker. */
export function pollBonusWeeks(
  tasks: { id: string; weekNumber: number; title: string }[],
): { id: string; label: string }[] {
  return tasks.map((t) => ({
    id: t.id,
    label: `week ${String(t.weekNumber).padStart(2, "0")}: ${t.title}`,
  }));
}
