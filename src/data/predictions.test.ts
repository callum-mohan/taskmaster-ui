import { describe, expect, it, vi } from "vitest";
import { derivePredictionBonusRows } from "./predictions";
import { player } from "../test/fixtures";

// Pure derivation; this only stops the db client's `astro:env` import
// loading (the prediction writes sit beside it).
vi.mock("../db", () => ({ getDb: () => undefined }));

describe("derivePredictionBonusRows", () => {
  const players = [player("ann", "Ann"), player("bob", "Bob")];
  const results = {
    scores: [
      { taskId: "w1", playerId: "bob", points: 9, position: 1 },
      { taskId: "w1", playerId: "ann", points: 4, position: 2 },
    ],
    teamScores: [],
  };
  const call = (playerId: string, pick: string) => ({
    taskId: "w1",
    playerId,
    pick: { type: "player" as const, id: pick },
  });

  it("pays +1 for a correct call and nothing for a miss", () => {
    expect(
      derivePredictionBonusRows(
        [call("ann", "bob"), call("bob", "ann")],
        results,
        players,
        new Map(),
      ),
    ).toEqual([
      {
        taskId: "w1",
        playerId: "ann",
        points: 1,
        reason: "Called the winner (Bob)",
      },
    ]);
  });

  it("pays +2 for a correct call backed with Double Down", () => {
    expect(
      derivePredictionBonusRows(
        [call("ann", "bob")],
        results,
        players,
        new Map(),
        new Set(["w1:ann"]),
      ),
    ).toEqual([
      {
        taskId: "w1",
        playerId: "ann",
        points: 2,
        reason: "Called the winner (Bob) · Double Down",
      },
    ]);
  });
});
