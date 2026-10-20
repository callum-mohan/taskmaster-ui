// The competition runs on UK time. Task and poll times are stored as
// zone-less wall-clock timestamps meaning Europe/London (GMT in winter, BST in
// summer), while the server (Cloudflare Workers) runs in UTC and visitors'
// browsers can be anywhere. Everything is converted to real instants and
// formatted in this zone so clocks agree whatever the runtime's zone.
export const SITE_TIME_ZONE = "Europe/London";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SITE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(ms: number): WallClock {
  const parts: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const utcOf = (w: WallClock) =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** UK offset from UTC (ms) at the given instant: 0 for GMT, 1h for BST. */
function offsetAt(ms: number): number {
  return utcOf(wallClockAt(ms)) - Math.floor(ms / 1000) * 1000;
}

/**
 * Zone-less UK wall-clock timestamp ("YYYY-MM-DD HH:MM[:SS]" or with a "T")
 * → ISO 8601 instant ("…Z"), so `new Date()` reads it correctly on the UTC
 * server and in any browser. Returns the input unchanged if it can't be read.
 */
export function wallClockToIso(timestamp: string): string {
  const m = timestamp
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return timestamp;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Resolve the offset twice so times either side of a clock change land on
  // the right side of it.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant).toISOString();
}

/**
 * A Postgres `timestamptz` string (e.g. "2026-10-15 13:55:43.12+00") → ISO
 * 8601 instant, so `new Date()` parses it the same everywhere.
 */
export function timestamptzToIso(timestamp: string): string {
  return new Date(
    timestamp
      .replace(" ", "T")
      .replace(/([+-]\d{2})(\d{2})?$/, (_, h, m) => `${h}:${m ?? "00"}`),
  ).toISOString();
}

/** An instant → zone-less UK wall-clock timestamp, as Postgres stores it. */
export function toWallClock(date: Date): string {
  const w = wallClockAt(date.getTime());
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${w.year}-${pad(w.month)}-${pad(w.day)} ` +
    `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`
  );
}

/** An `en-GB` date formatter pinned to UK time. */
export function ukDateFormat(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: SITE_TIME_ZONE,
  });
}
