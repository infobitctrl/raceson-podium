import type { PortalRaceCheckpoint, PortalTrackSegment } from "@/lib/portal-data";
import { translate, type TranslationKey } from "@/shared/i18n/messages";
import type { AppLocale } from "@/shared/i18n/locales";

export function isPublicRacePointRequired(checkpoint: PortalRaceCheckpoint) {
  const tags = checkpoint.typeTags.length ? checkpoint.typeTags : [checkpoint.type];
  return checkpoint.isMandatory || tags.some((tag) => tag === "checkpoint" || tag === "timing_split" || tag === "marshal");
}

export function eventPointName(name: string, locale: AppLocale) {
  const generated = /^Control Point (\d+)$/.exec(name);
  return generated ? translate(locale, "event.detail.pointNumber", { number: generated[1] }) : name;
}

export function eventRulesSafetyValues(input: {
  warnings?: string | null;
  checkpoints: PortalRaceCheckpoint[];
  documentsCount: number;
}, locale: AppLocale) {
  const t = (key: TranslationKey) => translate(locale, key);
  const required = input.checkpoints.filter(isPublicRacePointRequired).length;
  const cutoffs = input.checkpoints.filter((point) => Boolean(point.cutoffLabel)).length;
  return {
    responsibility: t("event.detail.responsibility"),
    markedCourse: t("event.detail.markedCourse"),
    checkpoints: required || cutoffs
      ? translate(locale, "event.detail.checkpointSummary", { required, cutoffs })
      : t("event.detail.notPublished"),
    weather: input.warnings?.trim() || t("event.detail.noWarning"),
    hasAuthorWarning: Boolean(input.warnings?.trim()),
    organizerNote: t("event.detail.organizerNote"),
    regulations: t(input.documentsCount ? "event.detail.seeDocuments" : "event.detail.noRulesDocument"),
  };
}

const segmentTypeKeys: Record<PortalTrackSegment["type"], TranslationKey> = {
  flat: "event.detail.segmentFlat",
  climb: "event.detail.segmentClimb",
  descent: "event.detail.segmentDescent",
};
const segmentDifficultyKeys: Record<PortalTrackSegment["difficulty"], TranslationKey> = {
  easy: "event.detail.segmentEasy",
  moderate: "event.detail.segmentModerate",
  hard: "event.detail.segmentHard",
  extreme: "event.detail.segmentExtreme",
};

export function eventSegmentPresentation(segment: PortalTrackSegment, locale: AppLocale) {
  const number = (value: number) => new Intl.NumberFormat(locale === "hr" ? "hr-HR" : "en-GB", {
    minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false,
  }).format(value);
  return {
    // TrackCreation uses this exact label for the generated start-to-finish segment.
    name: segment.name === "Full Route" ? translate(locale, "event.detail.fullTrack") : segment.name,
    type: translate(locale, segmentTypeKeys[segment.type]),
    difficulty: translate(locale, segmentDifficultyKeys[segment.difficulty]),
    range: translate(locale, "event.detail.segmentRange", {
      start: number(segment.startKm), end: number(segment.endKm), distance: number(segment.endKm - segment.startKm),
    }),
    grade: `${segment.avgGrade > 0 ? "+" : ""}${number(segment.avgGrade)}%`,
    comment: segment.comment?.trim() || translate(locale, "event.detail.segmentCommentEmpty"),
    hasAuthorComment: Boolean(segment.comment?.trim()),
  };
}
