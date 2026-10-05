import { Trophy } from "lucide-react";
import { getResultPodiumVisual } from "@/features/results/public/model/resultPodiumVisual";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedClassificationLabel } from "@/shared/i18n/domainLabels";

export function ResultPlaceBadge({
  place,
  compact = false,
  scopeLabel = "Overall",
}: {
  place: number;
  compact?: boolean;
  scopeLabel?: string;
}) {
  const { locale, t } = useI18n();
  const podiumVisual = getResultPodiumVisual(place);
  const normalizedScopeLabel = localizedClassificationLabel(scopeLabel.trim() || "Overall", locale);
  const accessibleScopeLabel = normalizedScopeLabel.toLowerCase() === "overall"
    ? (podiumVisual ? "overall" : t("common.overall"))
    : normalizedScopeLabel;
  const podiumLabel = place === 1
    ? t("results.podium.winner")
    : place === 2
      ? t("results.podium.second")
      : t("results.podium.third");
  const medalLabel = place === 1
    ? t("results.podium.gold")
    : place === 2
      ? t("results.podium.silver")
      : t("results.podium.bronze");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-black",
        compact ? "h-8 min-w-8 gap-0.5 px-1.5 text-[10px]" : "h-11 min-w-11 gap-1 px-2 text-xs",
        podiumVisual
          ? cn("border", podiumVisual.badgeClassName)
          : "text-muted-foreground",
      )}
      aria-label={podiumVisual
        ? t("results.podium.medalPlace", { medal: podiumLabel, scope: accessibleScopeLabel, place })
        : t("results.podium.place", { scope: accessibleScopeLabel, place })}
      title={podiumVisual
        ? t("results.podium.title", { medal: medalLabel, scope: normalizedScopeLabel, place })
        : t("results.podium.plainTitle", { scope: normalizedScopeLabel, place })}
    >
      {podiumVisual ? <Trophy className={compact ? "h-3.5 w-3.5" : "h-5 w-5"} aria-hidden="true" /> : null}
      <span>{place}</span>
    </span>
  );
}
