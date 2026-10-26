import type { APIRoute } from "astro";
import { recordScope } from "../../lib/season-scope";
import { withBase } from "../../lib/url";

// Escape per RFC 5545 text rules (backslash, comma, semicolon, newlines).
const escapeICS = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// UTC form ("20261009T140000Z"), so calendars place the deadline at the
// right UK time (GMT or BST) wherever the subscriber is.
const toICSStamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

// Fold lines to 75 octets per RFC 5545 (continuation lines start with a
// space). Keeps strict calendar parsers happy on long DESCRIPTION values.
const foldLine = (line: string) => {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) {
    chunks.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  if (rest.length > 0) chunks.push(` ${rest}`);
  return chunks.join("\r\n");
};

export const GET: APIRoute = async ({ params, site, locals }) => {
  const isAdmin = (await locals.getViewer())?.isAdmin ?? false;
  const scope = await recordScope(locals, "task", params.id, { isAdmin });
  const task = scope?.queries.getTaskById(params.id!);
  if (!task) {
    return new Response("Not found", { status: 404 });
  }

  const weekLabel = `Week ${String(task.weekNumber).padStart(2, "0")}`;
  const named = task.title.length > 0 && task.title !== "???";
  const summary = named
    ? `EAYL Taskmaster — ${weekLabel} deadline: ${task.title}`
    : `EAYL Taskmaster — ${weekLabel} deadline`;

  const taskUrl = site
    ? new URL(withBase(`/tasks/${task.id}`), site).href
    : withBase(`/tasks/${task.id}`);

  const briefText = Array.isArray(task.brief)
    ? task.brief.map((point) => `• ${point}`).join("\n")
    : task.brief;

  const description = [briefText || task.description, taskUrl]
    .filter(Boolean)
    .join("\n\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EAYL Taskmaster//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${task.id}-deadline@eayl-taskmaster`,
    `DTSTAMP:${toICSStamp(new Date())}`,
    `DTSTART:${toICSStamp(new Date(task.deadline))}`,
    `DURATION:PT30M`,
    `SUMMARY:${escapeICS(summary)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    `URL:${taskUrl}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS(summary)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // RFC 5545 requires CRLF line endings and folded long lines.
  const body = `${lines.map(foldLine).join("\r\n")}\r\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${task.id}-deadline.ics"`,
    },
  });
};
