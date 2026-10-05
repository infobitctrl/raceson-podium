import { CheckCircle2, Clock3, Radio, RefreshCw } from "lucide-react";
import {
  resolvePublicResultLifecycleState,
  type PublicResultLifecycleState,
} from "@/features/results/public/model/publicResultPresentation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { TranslationKey } from "@/shared/i18n/messages";

const lifecycleCopy: Record<PublicResultLifecycleState, {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof Radio;
  tone: string;
}> = {
  live: {
    labelKey: "results.page.hero.live",
    descriptionKey: "results.lifecycle.liveDescription",
    icon: Radio,
    tone: "border-trail-green/25 bg-trail-green/[0.07] text-trail-green",
  },
  unofficial: {
    labelKey: "results.page.hero.unofficial",
    descriptionKey: "results.lifecycle.unofficialDescription",
    icon: Clock3,
    tone: "border-trail-amber/25 bg-trail-amber/[0.07] text-trail-amber",
  },
  final: {
    labelKey: "results.page.hero.final",
    descriptionKey: "results.lifecycle.finalDescription",
    icon: CheckCircle2,
    tone: "border-primary/20 bg-primary/[0.055] text-primary-readable",
  },
  pending: {
    labelKey: "results.page.status.resultsPending",
    descriptionKey: "results.lifecycle.pendingDescription",
    icon: Clock3,
    tone: "border-border bg-muted/35 text-muted-foreground",
  },
};

export function PublicResultsLifecycleNotice({
  publicationState,
  pendingDescription,
  isRefreshing = false,
  isLoading = false,
  hasLoadError = false,
  onRetry,
  className,
}: {
  publicationState: string | null | undefined;
  pendingDescription?: string;
  isRefreshing?: boolean;
  isLoading?: boolean;
  hasLoadError?: boolean;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (isLoading || hasLoadError) {
    return <div role={hasLoadError ? "alert" : "status"} className={cn("rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-sm text-muted-foreground", className)}>
      <p>{t(hasLoadError ? "results.loadFailed" : "results.snapshotLoading")}</p>
      {hasLoadError && onRetry ? <Button type="button" variant="outline" size="sm" className="mt-2" disabled={isRefreshing} onClick={onRetry}>
        <RefreshCw className={cn("mr-2 h-3 w-3", isRefreshing && "animate-spin")} aria-hidden="true" />
        {t(isRefreshing ? "results.lifecycle.refreshing" : "common.tryAgain")}
      </Button> : null}
    </div>;
  }
  const state = resolvePublicResultLifecycleState(publicationState);
  const presentation = lifecycleCopy[state];
  const Icon = presentation.icon;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between",
        presentation.tone,
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", state === "live" && "animate-pulse")} aria-hidden="true" />
        <div className="min-w-0">
          <div data-locale-fit="pill" className="text-xs font-bold">{t(presentation.labelKey)}</div>
          <div className="mt-0.5 text-[10px] leading-4 opacity-80">
            {state === "pending" && pendingDescription ? pendingDescription : t(presentation.descriptionKey)}
          </div>
        </div>
      </div>
      {isRefreshing ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider opacity-75">
          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t("results.lifecycle.refreshing")}
        </span>
      ) : null}
    </div>
  );
}
