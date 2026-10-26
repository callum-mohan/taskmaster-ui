import type {
  ActivityEntry,
  ActivityKind,
  CompetitionData,
  ScoreAuditAction,
  ScoreAuditEntity,
  WeekScoreAuditEntry,
} from "../types";
import { POWER_UP_INFO } from "./coins";
import { getCrate } from "./coin-rules";
import { getSkillNode, getSkillPath } from "./skill-trees";
import { weekHref } from "../lib/admin-nav";

// The admin activity log: one timeline of everything that moved points or
// Clim Coin in a season, for settling disputes. Score changes come from
// `score_audit_log` (passed in, since it isn't part of the snapshot); the
// rest is read from the season's coin records.

/** Labels for the activity log's kind filter, in display order. */
export const ACTIVITY_KINDS: Record<ActivityKind, string> = {
  score: "scores & bonuses",
  "coin-adjustment": "coin grants",
  "item-gift": "item gifts",
  "mini-task": "mini-tasks",
  purchase: "purchases",
  crate: "crates",
  gift: "player gifts",
  "power-up": "power-ups",
  skill: "skills",
  wish: "wishes",
  market: "marketplace",
};

export const isActivityKind = (value: string): value is ActivityKind =>
  Object.hasOwn(ACTIVITY_KINDS, value);

/** Which entries to show. */
export interface ActivityFilter {
  kind?: ActivityKind;
  /** A player or squad id: entries that affected them. */
  subjectId?: string;
}

const ENTITY_LABEL: Record<ScoreAuditEntity, string> = {
  task_score: "score",
  team_score: "squad score",
  bonus: "bonus",
};

const ACTION_LABEL: Record<ScoreAuditAction, string> = {
  created: "added",
  updated: "changed",
  deleted: "removed",
};

const pad = (n: number) => String(n).padStart(2, "0");
const instant = (iso: string) => new Date(iso).getTime();

/** Activity-log selectors (spread into `createQueries`). */
export function createActivityQueries(data: CompetitionData) {
  const names = new Map<string, string>([
    ...data.players.map((p) => [p.id, p.name] as const),
    ...data.teams.map((t) => [t.id, t.name] as const),
  ]);
  const nameOf = (id: string) => names.get(id) ?? id;
  const weekOf = new Map(data.tasks.map((t) => [t.id, t.weekNumber]));
  const weekLabel = (taskId: string) => {
    const week = weekOf.get(taskId);
    return week === undefined ? taskId : `Week ${pad(week)}`;
  };
  const itemName = new Map(data.coins.items.map((i) => [i.id, i.name]));
  const itemOf = (id: string) => itemName.get(id) ?? id;
  const playerHref = (id: string) => `/admin/players/${encodeURIComponent(id)}`;

  function scoreEntries(
    audit: readonly WeekScoreAuditEntry[],
  ): ActivityEntry[] {
    return audit.map((row) => {
      const points =
        row.action === "updated"
          ? `${row.pointsBefore ?? "—"} → ${row.pointsAfter ?? "—"}`
          : String(row.pointsAfter ?? row.pointsBefore ?? "—");
      const noteChanged =
        row.action === "updated" && row.noteBefore !== row.noteAfter;
      const note = noteChanged
        ? `note: "${row.noteBefore ?? ""}" → "${row.noteAfter ?? ""}"`
        : (row.noteAfter ?? row.noteBefore);
      return {
        id: `score:${row.id}`,
        kind: "score",
        at: row.at,
        actor: row.actorName,
        byAdmin: true,
        subjectIds: [row.subjectId],
        summary: `${weekLabel(row.taskId)} · ${ACTION_LABEL[row.action]} ${
          ENTITY_LABEL[row.entity]
        } · ${nameOf(row.subjectId)}: ${points} pts`,
        ...(note && { detail: note }),
        href: weekHref(row.taskId, "judge"),
      };
    });
  }

  function coinEntries(): ActivityEntry[] {
    const { coins } = data;
    const freePurchases = new Set([
      ...coins.crateOpens.map((o) => o.purchaseId),
      ...coins.itemGifts.map((g) => g.purchaseId),
      ...coins.skillUnlocks.flatMap((u) => u.purchaseId ?? []),
      ...coins.market.sales.map((sale) => sale.buyerPurchaseId),
    ]);
    const miniTasks = new Map(coins.miniTasks.map((t) => [t.id, t]));
    return [
      ...coins.adjustments.map(
        (a): ActivityEntry => ({
          id: `coin-adjustment:${a.id}`,
          kind: "coin-adjustment",
          at: a.at,
          actor: a.actorName,
          byAdmin: true,
          subjectIds: [a.playerId],
          summary: `${a.amount > 0 ? "Granted" : "Deducted"} ${Math.abs(
            a.amount,
          )} Clim Coin ${a.amount > 0 ? "to" : "from"} ${nameOf(a.playerId)}`,
          detail: a.reason,
          coins: a.amount,
          href: playerHref(a.playerId),
        }),
      ),
      ...coins.itemGifts.map(
        (g): ActivityEntry => ({
          id: `item-gift:${g.id}`,
          kind: "item-gift",
          at: g.at,
          actor: g.actorName,
          byAdmin: true,
          subjectIds: [g.playerId],
          summary: `Gifted ${itemOf(g.itemId)} to ${nameOf(g.playerId)}`,
          detail: g.reason,
          href: playerHref(g.playerId),
        }),
      ),
      ...coins.miniTaskCompletions.flatMap((done): ActivityEntry[] => {
        const task = miniTasks.get(done.miniTaskId);
        if (!task) return [];
        return [
          {
            id: `mini-task:${done.miniTaskId}:${done.playerId}`,
            kind: "mini-task",
            at: done.at,
            actor: done.actorName,
            byAdmin: true,
            subjectIds: [done.playerId],
            summary: `Ticked off ${nameOf(done.playerId)}: ${task.title}`,
            coins: task.reward,
            href: `/admin/mini-tasks/${task.id}`,
          },
        ];
      }),
      ...coins.purchases
        .filter((p) => !freePurchases.has(p.id))
        .map(
          (p): ActivityEntry => ({
            id: `purchase:${p.id}`,
            kind: "purchase",
            at: p.at,
            actor: nameOf(p.playerId),
            byAdmin: false,
            subjectIds: [p.playerId],
            // A zero-price row outside crates, gifts and skills was granted
            // directly (e.g. by a migration), so it wasn't really bought.
            ...(p.price > 0
              ? {
                  summary: `${nameOf(p.playerId)} bought ${itemOf(p.itemId)}`,
                  coins: -p.price,
                }
              : {
                  summary: `${nameOf(p.playerId)} was given ${itemOf(p.itemId)}`,
                  detail: "free",
                }),
            href: playerHref(p.playerId),
          }),
        ),
      ...coins.crateOpens.map(
        (o): ActivityEntry => ({
          id: `crate:${o.id}`,
          kind: "crate",
          at: o.at,
          actor: nameOf(o.playerId),
          byAdmin: false,
          subjectIds: [o.playerId],
          summary: `${nameOf(o.playerId)} opened ${
            getCrate(o.crateId)?.name ?? o.crateId
          } → ${itemOf(o.itemId)}`,
          detail: o.rarity === "power_up" ? "power-up" : o.rarity,
          coins: -o.price,
          href: playerHref(o.playerId),
        }),
      ),
      ...coins.gifts.map(
        (g): ActivityEntry => ({
          id: `gift:${g.id}`,
          kind: "gift",
          at: g.at,
          actor: nameOf(g.fromPlayerId),
          byAdmin: false,
          subjectIds: [g.fromPlayerId, g.toPlayerId],
          summary: `${nameOf(g.fromPlayerId)} sent ${g.amount} Clim Coin to ${nameOf(
            g.toPlayerId,
          )}`,
          ...(g.message && { detail: `"${g.message}"` }),
          coins: g.amount,
          href: playerHref(g.fromPlayerId),
        }),
      ),
      ...coins.market.sales.map(
        (sale): ActivityEntry => ({
          id: `market:${sale.id}`,
          kind: "market",
          at: sale.at,
          actor: nameOf(sale.buyerId),
          byAdmin: false,
          subjectIds: [sale.sellerId, sale.buyerId],
          summary: `${nameOf(sale.buyerId)} bought ${itemOf(sale.itemId)} from ${nameOf(
            sale.sellerId,
          )} on the market`,
          ...(sale.offerId !== undefined && { detail: "accepted offer" }),
          coins: sale.price,
          href: playerHref(sale.buyerId),
        }),
      ),
      ...coins.uses.map(
        (u): ActivityEntry => ({
          id: `power-up:${u.id}`,
          kind: "power-up",
          at: u.at,
          actor: nameOf(u.playerId),
          byAdmin: false,
          subjectIds: [
            u.playerId,
            ...(u.targetPlayerId ? [u.targetPlayerId] : []),
          ],
          summary: `${nameOf(u.playerId)} used ${POWER_UP_INFO[u.effect].label}${
            u.targetPlayerId ? ` on ${nameOf(u.targetPlayerId)}` : ""
          } · ${weekLabel(u.taskId)}`,
          href: weekHref(u.taskId, "judge"),
        }),
      ),
      ...coins.skillUnlocks.map(
        (u): ActivityEntry => ({
          id: `skill:${u.id}`,
          kind: "skill",
          at: u.at,
          actor: nameOf(u.playerId),
          byAdmin: false,
          subjectIds: [u.playerId],
          summary: `${nameOf(u.playerId)} unlocked ${
            getSkillNode(u.nodeId)?.name ?? u.nodeId
          } (${getSkillPath(u.pathId)?.name ?? u.pathId})`,
          coins: -u.price,
          href: playerHref(u.playerId),
        }),
      ),
      ...coins.wishes.flatMap((w): ActivityEntry[] => [
        {
          id: `wish:${w.id}`,
          kind: "wish",
          at: w.at,
          actor: nameOf(w.playerId),
          byAdmin: false,
          subjectIds: [w.playerId],
          summary: `${nameOf(w.playerId)} made a wish`,
          detail: `"${w.wish}"`,
          href: "/admin#wishes",
        },
        ...(w.decidedAt && w.status !== "pending"
          ? [
              {
                id: `wish-decided:${w.id}`,
                kind: "wish" as const,
                at: w.decidedAt,
                actor: w.deciderName ?? "an admin",
                byAdmin: true,
                subjectIds: [w.playerId],
                summary: `${w.status === "granted" ? "Granted" : "Declined"} ${nameOf(
                  w.playerId,
                )}'s wish`,
                ...(w.response && { detail: w.response }),
                href: "/admin#wishes",
              },
            ]
          : []),
      ]),
    ];
  }

  /**
   * The season's activity, newest first, narrowed by `filter`. `audit` is
   * the season's score history (`listScoreAuditForWeeks`).
   */
  function getActivityLog(
    audit: readonly WeekScoreAuditEntry[],
    filter: ActivityFilter = {},
  ): ActivityEntry[] {
    return [...scoreEntries(audit), ...coinEntries()]
      .filter(
        (entry) =>
          (!filter.kind || entry.kind === filter.kind) &&
          (!filter.subjectId || entry.subjectIds.includes(filter.subjectId)),
      )
      .sort(
        (a, b) => instant(b.at) - instant(a.at) || b.id.localeCompare(a.id),
      );
  }

  return { getActivityLog };
}
