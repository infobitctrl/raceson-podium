import type { SportCode } from "@raceson/domain/sports";
import type { TranslationKey } from "@/shared/i18n/messages";

export const sportMessageKeys: Record<SportCode, TranslationKey> = {
  trail_running: "sport.trailRunning",
  road_running: "sport.roadRunning",
  swimming: "sport.swimming",
  road_cycling: "sport.roadCycling",
  mountain_biking: "sport.mountainBiking",
  duathlon: "sport.duathlon",
  triathlon: "sport.triathlon",
  aquathlon: "sport.aquathlon",
};
