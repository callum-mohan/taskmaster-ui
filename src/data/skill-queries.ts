import type {
  CompetitionData,
  PlayerSkills,
  SkillBlock,
  SkillLog,
  SkillNode,
  SkillNodeView,
  SkillPathView,
  SkillPerks,
  SkillTreesView,
} from "../types";
import {
  SKILL_PATHS,
  getSkillPath,
  nodesByTier,
  pathCost,
  unlockedNodes,
} from "./skill-trees";
import type { ShopViewer } from "./coin-queries";

/**
 * Skill tree selectors (spread into `createQueries`): every pathway as one
 * viewer sees it, and a player's committed pathway. Pure over the snapshot;
 * `unlockSkillNode` re-checks the stored facts. The balance and perks come
 * from the coin queries, so prices are checked against the same number the
 * wallet shows.
 */
export function createSkillQueries(
  data: CompetitionData,
  deps: {
    getBalance: (playerId: string) => number;
    getSkillPerks: (playerId: string) => SkillPerks;
  },
) {
  const { getBalance, getSkillPerks } = deps;
  const { players, coins, season, features } = data;
  const playerIds = new Set(players.map((p) => p.id));
  const itemById = new Map(coins.items.map((i) => [i.id, i]));
  const seasonClosed = season.status === "closed";

  /** The pathway a player committed to, if any. */
  function getChosenPath(playerId: string) {
    const pick = coins.skillPaths.find((p) => p.playerId === playerId);
    return pick && getSkillPath(pick.pathId);
  }

  function unlockedIds(playerId: string): Set<string> {
    return new Set(
      unlockedNodes(coins.skillUnlocks, playerId).map((n) => n.id),
    );
  }

  /**
   * Why `viewer` can't unlock `node` now, or `undefined` when they can.
   * Checked in order: who they are, the season, then the tree itself.
   */
  function getSkillBlock(
    node: SkillNode,
    viewer: ShopViewer,
  ): SkillBlock | undefined {
    const playerId = viewer.playerId;
    if (!playerId || !playerIds.has(playerId)) return "guest";
    return blockFor(node, playerSnapshot(playerId));
  }

  interface PlayerSnapshot {
    unlocked: Set<string>;
    chosenId?: string;
    balance: number;
  }

  const playerSnapshot = (playerId: string): PlayerSnapshot => ({
    unlocked: unlockedIds(playerId),
    chosenId: getChosenPath(playerId)?.id,
    balance: getBalance(playerId),
  });

  function blockFor(
    node: SkillNode,
    { unlocked, chosenId, balance }: PlayerSnapshot,
  ): SkillBlock | undefined {
    if (unlocked.has(node.id)) return "unlocked";
    if (seasonClosed) return "season-closed";
    if (chosenId && chosenId !== node.pathId) return "other-path";
    if (node.requires.some((id) => !unlocked.has(id))) return "locked";
    if (balance < node.price) return "unaffordable";
    return undefined;
  }

  /** Every pathway and node as `viewer` sees them (the `/skills` page). */
  function getSkillTrees(viewer: ShopViewer): SkillTreesView {
    const playerId =
      viewer.playerId && playerIds.has(viewer.playerId)
        ? viewer.playerId
        : undefined;
    const snapshot = playerId ? playerSnapshot(playerId) : undefined;
    const unlocked = snapshot?.unlocked ?? new Set<string>();
    const chosen = playerId ? getChosenPath(playerId) : undefined;
    const paths: SkillPathView[] = SKILL_PATHS.map((path) => {
      const nodeById = new Map(path.nodes.map((n) => [n.id, n]));
      const toView = (node: SkillNode): SkillNodeView => {
        const blocked: SkillBlock | undefined = snapshot
          ? blockFor(node, snapshot)
          : "guest";
        const reward = node.rewardItemId
          ? itemById.get(node.rewardItemId)
          : undefined;
        return {
          node,
          unlocked: unlocked.has(node.id),
          ...(blocked && { blocked }),
          missing: node.requires.flatMap((id) =>
            unlocked.has(id) ? [] : (nodeById.get(id) ?? []),
          ),
          ...(reward && { reward }),
        };
      };
      return {
        path,
        chosen: chosen?.id === path.id,
        tiers: nodesByTier(path).map((tier) => tier.map(toView)),
        unlockedCount: path.nodes.filter((n) => unlocked.has(n.id)).length,
        totalCost: pathCost(path),
      };
    });
    // The viewer's own pathway first.
    paths.sort((a, b) => Number(b.chosen) - Number(a.chosen));
    return {
      paths,
      ...(chosen && { chosen }),
      ...(playerId && {
        balance: snapshot?.balance ?? 0,
        perks: getSkillPerks(playerId),
      }),
    };
  }

  /**
   * A player's pathway and what they've unlocked in it, for their profile.
   * Hidden while the skill trees flag is off.
   */
  function getPlayerSkills(playerId: string): PlayerSkills | undefined {
    if (!features.skill_trees) return undefined;
    const path = getChosenPath(playerId);
    if (!path) return undefined;
    const unlocked = unlockedIds(playerId);
    return {
      path,
      unlocked: path.nodes.filter((n) => unlocked.has(n.id)),
      total: path.nodes.length,
    };
  }

  /** A player's pathway and unlocks with prices, flag or not (for admins). */
  function getSkillLog(playerId: string): SkillLog {
    const path = getChosenPath(playerId);
    return {
      ...(path && { path }),
      unlocks: coins.skillUnlocks.flatMap((u) => {
        const node = path?.nodes.find((n) => n.id === u.nodeId);
        return u.playerId === playerId && node
          ? [{ node, price: u.price, at: u.at }]
          : [];
      }),
    };
  }

  return {
    skillTreesOn: features.skill_trees,
    getSkillLog,
    getSkillBlock,
    getSkillTrees,
    getPlayerSkills,
  };
}
