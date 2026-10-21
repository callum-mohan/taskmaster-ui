import type { CompetitionData, GameRules } from "../types";
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  MAX_TEXT_LENGTH,
} from "../lib/submission-forms";
import {
  PEOPLES_CHOICE_BONUS_POINTS,
  PEOPLES_CHOICE_WINDOW_MS,
} from "./peoples-choice";
import { PREDICTION_BONUS_POINTS } from "./predictions";
import { COIN_RULES } from "./coin-rules";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rules page's facts (spread into `createQueries`). */
export function createRulesQueries(data: CompetitionData) {
  const { players, teams, tasks } = data;

  function getGameRules(): GameRules {
    const sizes = teams.map((t) => t.memberIds.length);
    return {
      totalWeeks: tasks.length,
      individualTasks: tasks.filter((t) => t.format === "individual").length,
      teamTasks: tasks.filter((t) => t.format === "team").length,
      playerCount: players.length,
      teamCount: teams.length,
      teamSize: {
        min: sizes.length ? Math.min(...sizes) : 0,
        max: sizes.length ? Math.max(...sizes) : 0,
      },
      peoplesChoice: {
        bonusPoints: PEOPLES_CHOICE_BONUS_POINTS,
        windowDays: Math.round(PEOPLES_CHOICE_WINDOW_MS / DAY_MS),
      },
      predictionBonusPoints: PREDICTION_BONUS_POINTS,
      submissions: {
        maxPhotoMb: Math.round(MAX_PHOTO_BYTES / (1024 * 1024)),
        maxTextChars: MAX_TEXT_LENGTH,
        maxCaptionChars: MAX_CAPTION_LENGTH,
      },
      coins: COIN_RULES,
    };
  }

  return { getGameRules };
}
