import type { EventActivityType } from "@raceson/domain/activities";
import type { TranslationKey } from "@/shared/i18n/messages";

export const activityTypeMessageKeys: Record<EventActivityType, TranslationKey> = {
  race: "activity.race",
  training: "activity.training",
  recreational: "activity.recreational",
  club_activity: "activity.clubActivity",
  community: "activity.community",
};

export const activityTypeDescriptionKeys: Record<EventActivityType, TranslationKey> = {
  race: "activity.race.description",
  training: "activity.training.description",
  recreational: "activity.recreational.description",
  club_activity: "activity.clubActivity.description",
  community: "activity.community.description",
};
