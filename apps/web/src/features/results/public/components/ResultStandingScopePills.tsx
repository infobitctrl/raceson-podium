import type { ResultStandingScope } from "@/features/results/public/model/resultStandingScopes";
import { useI18n } from "@/shared/i18n/I18nContext";
import { localizedClassificationLabel } from "@/shared/i18n/domainLabels";
import { MobileFilterButton, MobileFilterRail, MobileFilterSelect } from "@/shared/mobile/MobileFilterRail";

export function ResultStandingScopePills({
  scopes,
  activeScopeId,
  onScopeChange,
  ariaLabel,
}: {
  scopes: ResultStandingScope[];
  activeScopeId: string | null;
  onScopeChange: (scopeId: string) => void;
  ariaLabel?: string;
}) {
  const { locale, t } = useI18n();
  if (!scopes.length) return null;
  const accessibleLabel = ariaLabel ?? t("results.standingCategories");

  return (
    <div className="rounded-xl border border-border/70 bg-card/75 p-2 sm:rounded-2xl sm:p-3">
      <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2.5 lg:flex-row lg:items-center">
        <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:w-28 sm:shrink-0 sm:text-[10px] sm:tracking-[0.2em]">
          {t("common.standings")}
        </div>
        <MobileFilterSelect
          label={accessibleLabel}
          value={activeScopeId ?? scopes[0].id}
          options={scopes.map((scope) => ({
            value: scope.id,
            label: `${scope.kind === "overall" ? t("common.all") : localizedClassificationLabel(scope.label, locale)} (${scope.count})`,
          }))}
          onChange={onScopeChange}
          showLabel={false}
        />
        <MobileFilterRail role="group" aria-label={accessibleLabel}>
          {scopes.map((scope) => {
            const isActive = scope.id === activeScopeId;
            const localizedLabel = localizedClassificationLabel(scope.label, locale);

            return (
              <MobileFilterButton
                key={scope.id}
                type="button"
                aria-label={`${localizedLabel} ${scope.count}`}
                aria-pressed={isActive}
                onClick={() => onScopeChange(scope.id)}
                data-locale-fit="pill"
                className={`px-3 text-[10px] sm:text-xs ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary text-secondary-foreground hover:bg-muted"
                }`}
              >
                <span className="sm:hidden">{scope.shortLabel}</span>
                <span className="hidden sm:inline">{localizedLabel}</span>
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive
                    ? "bg-white/20 text-primary-foreground"
                    : "bg-background text-muted-foreground"
                }`}>
                  {scope.count}
                </span>
              </MobileFilterButton>
            );
          })}
        </MobileFilterRail>
      </div>
    </div>
  );
}
