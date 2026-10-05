import type { RefCallback } from "react";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/shared/i18n/I18nContext";

type ProgressiveListControlsProps = {
  visibleCount: number;
  totalCount: number;
  canLoadMore: boolean;
  batchSize?: number;
  itemLabel: string;
  onLoadMore: () => void;
  sentinelRef: RefCallback<HTMLDivElement>;
  className?: string;
  showingLabel?: string;
  allLoadedLabel?: string;
};

export default function ProgressiveListControls({
  visibleCount,
  totalCount,
  canLoadMore,
  batchSize = 20,
  itemLabel,
  onLoadMore,
  sentinelRef,
  className,
  showingLabel,
  allLoadedLabel,
}: ProgressiveListControlsProps) {
  const { t } = useI18n();
  if (totalCount === 0) return null;

  return (
    <div className={`mt-8 flex flex-col items-center gap-3 ${className ?? ""}`}>
      <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {showingLabel ?? (canLoadMore
          ? t("progress.showing", { visible: visibleCount, total: totalCount, items: itemLabel })
          : t("progress.showingAll", { total: totalCount, items: itemLabel }))}
      </div>
      {canLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-soft transition-colors hover:border-primary/30 hover:text-primary"
        >
          <ArrowDown className="h-4 w-4" />
          {t("progress.loadMore", { count: batchSize })}
        </button>
      ) : (
        <div className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-soft">
          {allLoadedLabel ?? t("progress.allLoaded", { items: itemLabel })}
        </div>
      )}
    </div>
  );
}
