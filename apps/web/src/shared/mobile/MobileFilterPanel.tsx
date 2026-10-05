"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";

/** One disclosure for secondary list controls; desktop controls stay expanded. */
export function MobileFilterPanel({
  children,
  activeCount = 0,
  onClear,
  summary,
  className,
}: {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  summary?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closePanel() {
    setExpanded(false);
    triggerRef.current?.focus();
  }

  return (
    <div data-mobile-filter-panel className={cn("min-w-0 rounded-2xl border border-border bg-card p-3 shadow-soft lg:rounded-[28px] lg:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 lg:hidden">
        {summary ? <div className="min-w-0 text-xs font-semibold text-muted-foreground">{summary}</div> : null}
        <div className="flex min-w-[min(100%,12rem)] flex-1 items-center gap-1">
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((current) => !current)}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2 text-left text-sm font-semibold text-foreground outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t("mobile.filters.title")}</span>
            {activeCount > 0 ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                <span aria-hidden="true">{activeCount}</span>
                <span className="sr-only">{t("mobile.filters.active", { count: activeCount })}</span>
              </span>
            ) : null}
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground", expanded && "rotate-180")} aria-hidden="true" />
          </button>
          {activeCount > 0 && onClear ? (
            <button type="button" onClick={onClear} className="min-h-11 shrink-0 rounded-xl px-2 text-xs font-semibold text-primary outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary">
              {t("mobile.filters.clear")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Keep one mounted control tree so disclosure and breakpoint changes preserve edits. */}
      <div
        id={panelId}
        data-mobile-filter-content
        className={cn(
          "min-w-0 max-lg:[&_input]:min-h-11 max-lg:[&_input]:text-base max-lg:[&_select]:min-h-11 max-lg:[&_select]:text-base",
          expanded ? "mt-3 border-t border-border/70 pt-3 lg:mt-0 lg:border-0 lg:pt-0" : "hidden lg:block",
        )}
      >
        {children}
        <button type="button" onClick={closePanel} className="mt-3 min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden">
          {t("mobile.filters.done")}
        </button>
      </div>
    </div>
  );
}
