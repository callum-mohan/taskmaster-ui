import type { Task, TaskStatus, TaskFormat } from "../types";

/**
 * Derives a task's status purely from its release/deadline dates, so the
 * status is always consistent with the clock and self-corrects as time
 * passes (e.g. a live task flips to "completed" once its deadline passes)
 * instead of relying on a hardcoded value that can go stale.
 *
 *   now < releaseDate            → "upcoming" (brief still encrypted)
 *   releaseDate <= now < deadline → "live"     (task is open)
 *   now >= deadline              → "completed" (task closed)
 */
export function deriveTaskStatus(
  task: Pick<Task, "releaseDate" | "deadline">,
  now: number = Date.now(),
): TaskStatus {
  const release = new Date(task.releaseDate).getTime();
  const deadline = new Date(task.deadline).getTime();
  if (Number.isNaN(release) || Number.isNaN(deadline) || now < release) {
    return "upcoming";
  }
  return now < deadline ? "live" : "completed";
}

// 16 weekly tasks. Dates are mock values (local time, Fridays at 13:00).
// Status is intentionally omitted here and derived from the dates below, so
// this schedule is the single source of truth. `format` defaults to
// "individual"; set it to "team" for a squad task (see week-04). Swap this
// array for a Supabase query later without changing consumers.
const schedule: (Omit<Task, "status" | "format"> & {
  format?: TaskFormat;
})[] = [
  {
    id: "week-01",
    weekNumber: 1,
    title: "Eggy?",
    description: "Keep your egg alive for the entire week.",
    brief:
      "For the next seven days you are responsible for someone who cannot speak, cannot walk, and absolutely cannot be allowed to crack under pressure. Keep your egg safe until Friday afternoon. Your time starts now.",
    releaseDate: "2026-09-18T13:00:00",
    deadline: "2026-09-25T13:00:00",
  },
  {
    id: "week-02",
    weekNumber: 2,
    title: "Put Yourself On The Map",
    description: "Navigate a route that creates a drawing on a map.",
    brief:
      "Using any mapping tool of your choice, plan and navigate a route that, when traced on a map, forms a recognizable drawing. Creativity and accuracy are key.",
    releaseDate: "2026-09-25T13:00:00",
    deadline: "2026-10-02T13:00:00",
  },
  {
    id: "week-03",
    weekNumber: 3,
    title: "Assassin",
    description: "Complete your secret mission. Stay alive.",
    brief: [
      "Complete your secret mission and eliminate your target.",
      "Once successful, discreetly tell your target and the Taskmaster.",
      "Your eliminated target must then hand their mission to you.",
      "If eliminated, you may assist others but never reveal that you have been eliminated.",
      "Be cunning. Be devious. Trust no one.",
    ],
    releaseDate: "2026-10-02T13:00:00",
    deadline: "2026-10-09T13:00:00",
  },
  {
    id: "week-04",
    weekNumber: 4,
    title: "Task Tank",
    description: "",
    brief: "",
    releaseDate: "2026-10-09T13:00:00",
    deadline: "2026-10-16T13:00:00",
    format: "team",
  },
  {
    id: "week-05",
    weekNumber: 5,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-10-16T13:00:00",
    deadline: "2026-10-23T13:00:00",
  },
  {
    id: "week-06",
    weekNumber: 6,
    title: "New Roots",
    description: "",
    brief: "",
    releaseDate: "2026-10-23T13:00:00",
    deadline: "2026-10-30T13:00:00",
  },
  {
    id: "week-07",
    weekNumber: 7,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-10-30T13:00:00",
    deadline: "2026-11-06T13:00:00",
  },
  {
    id: "week-08",
    weekNumber: 8,
    title: "Humpty Dumpty",
    description: "",
    brief: "",
    releaseDate: "2026-11-06T13:00:00",
    deadline: "2026-11-13T13:00:00",
    format: "team",
  },
  {
    id: "week-09",
    weekNumber: 9,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-11-13T13:00:00",
    deadline: "2026-11-20T13:00:00",
  },
  {
    id: "week-10",
    weekNumber: 10,
    title: "Whac-A-Mole",
    description: "",
    brief: "",
    releaseDate: "2026-11-20T13:00:00",
    deadline: "2026-11-27T13:00:00",
  },
  {
    id: "week-11",
    weekNumber: 11,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-11-27T13:00:00",
    deadline: "2026-12-04T13:00:00",
  },
  {
    id: "week-12",
    weekNumber: 12,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-12-04T13:00:00",
    deadline: "2026-12-11T13:00:00",
    format: "team",
  },
  {
    id: "week-13",
    weekNumber: 13,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2026-12-11T13:00:00",
    deadline: "2026-12-18T13:00:00",
  },
  {
    id: "week-14",
    weekNumber: 14,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2027-01-01T13:00:00",
    deadline: "2027-01-08T13:00:00",
  },
  {
    id: "week-15",
    weekNumber: 15,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2027-01-08T13:00:00",
    deadline: "2027-01-15T13:00:00",
  },
  {
    id: "week-16",
    weekNumber: 16,
    title: "???",
    description: "",
    brief: "",
    releaseDate: "2027-01-15T13:00:00",
    deadline: "2027-01-22T13:00:00",
    format: "team",
  },
];

// The schedule with each task's status computed from its dates. Consumers
// import this (never `schedule`) so they always see a clock-correct status.
// `format` defaults to "individual" when a task does not declare one.
export const tasks: Task[] = schedule.map((task) => ({
  ...task,
  format: task.format ?? "individual",
  status: deriveTaskStatus(task),
}));

export function getTaskById(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function getCurrentTask(): Task | undefined {
  return (
    tasks.find((t) => t.status === "live") ??
    tasks.find((t) => t.status === "upcoming")
  );
}

/** Team-format tasks on the schedule, ascending by week number. */
export function getTeamTasks(): Task[] {
  return tasks
    .filter((t) => t.format === "team")
    .sort((a, b) => a.weekNumber - b.weekNumber);
}
