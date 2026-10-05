import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, MoreHorizontal, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";

export type MobileWorkspaceNavigationItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  activeWhen?: (pathname: string) => boolean;
  statusLabel?: string;
  visualGroup?: string;
};

function isNavigationItemActive(item: MobileWorkspaceNavigationItem, pathname: string) {
  return item.activeWhen ? item.activeWhen(pathname) : pathname === item.path;
}

export function MobileWorkspaceNavigation({
  label,
  items,
  moreItems,
  moreUtilities,
  className,
}: {
  label: string;
  items: MobileWorkspaceNavigationItem[];
  moreItems?: MobileWorkspaceNavigationItem[];
  moreUtilities?: ReactNode;
  className?: string;
}) {
  const location = useLocation();
  const { t } = useI18n();
  const hasMoreMenu = Boolean(moreItems?.length || moreUtilities || items.length > 5);
  const visibleItems = items.slice(0, 5);
  const visiblePaths = new Set(visibleItems.map((item) => item.path));
  const overflowItems = [...items.slice(visibleItems.length), ...(moreItems ?? [])]
    .filter((item, index, all) => !visiblePaths.has(item.path) && all.findIndex((candidate) => candidate.path === item.path) === index);
  const moreActive = overflowItems.some((item) => isNavigationItemActive(item, location.pathname));

  return (
    <nav
      aria-label={label}
      className={cn(
        "mobile-bottom-navigation z-40 shrink-0 border-t border-border/80 bg-card/95 shadow-[0_-10px_30px_hsl(var(--foreground)/0.05)] backdrop-blur supports-[backdrop-filter]:bg-card/90 lg:hidden",
        className,
      )}
    >
      <div
        className="grid h-16 items-stretch px-1"
        style={{
          gridTemplateColumns: `repeat(${visibleItems.length + (hasMoreMenu ? 1 : 0)}, minmax(0, 1fr))`,
        }}
      >
        {visibleItems.map((item, index) => {
          const active = isNavigationItemActive(item, location.pathname);
          const Icon = item.icon;
          const startsVisualGroup = Boolean(
            item.visualGroup && visibleItems[index - 1]?.visualGroup !== item.visualGroup,
          );
          const endsVisualGroup = Boolean(
            item.visualGroup && visibleItems[index + 1]?.visualGroup !== item.visualGroup,
          );

          return (
            <Link
              key={`${item.label}-${item.path}`}
              to={item.path}
              aria-current={active ? "page" : undefined}
              data-navigation-group={item.visualGroup}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-1 text-[10px] font-semibold leading-none transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                item.visualGroup && "my-1 border-y border-trail-amber/25 bg-trail-amber/[0.08]",
                startsVisualGroup && "ml-1 rounded-l-xl border-l",
                endsVisualGroup && "mr-1 rounded-r-xl border-r",
                active ? "text-primary-readable" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="flex min-h-7 max-w-full items-center justify-center text-center leading-[14px] [overflow-wrap:anywhere]">{item.label}</span>
              {active ? (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-primary" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}

        {hasMoreMenu ? (
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-1 text-[10px] font-semibold leading-none transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                  moreActive ? "text-primary-readable" : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={`${t("common.more")}. ${t("nav.moreOptions")}`}
                aria-current={moreActive ? "page" : undefined}
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                <span className="flex min-h-7 items-center leading-[14px]">{t("common.more")}</span>
                {moreActive ? (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-primary" aria-hidden="true" />
                ) : null}
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              showClose={false}
              overlayClassName="bg-slate-950/28 backdrop-blur-[6px]"
              className="z-[70] max-h-[min(85vh,36rem)] overflow-y-auto rounded-t-3xl border-border/80 bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-24px_70px_-30px_hsl(var(--foreground)/0.45)]"
            >
              <SheetHeader className="relative pr-12 text-left">
                <SheetTitle className="font-display text-xl font-black">{t("common.more")}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t("nav.moreOptionsLabel", { workspace: label })}
                </SheetDescription>
                <SheetClose
                  aria-label={t("common.close")}
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </SheetClose>
              </SheetHeader>
              {overflowItems.length ? (
                <nav
                  aria-label={t("nav.moreOptionsLabel", { workspace: label })}
                  className="mt-3 space-y-1"
                >
                  {overflowItems.map((item) => {
                    const active = isNavigationItemActive(item, location.pathname);
                    const Icon = item.icon;

                    return (
                      <SheetClose key={`${item.label}-${item.path}`} asChild>
                        <Link
                          to={item.path}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            active ? "bg-primary/10 text-primary-readable" : "text-foreground",
                          )}
                        >
                          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.statusLabel ? (
                            <span className="shrink-0 rounded-full border border-trail-amber/35 bg-trail-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-trail-amber">
                              {item.statusLabel}
                            </span>
                          ) : null}
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </SheetClose>
                    );
                  })}
                </nav>
              ) : null}
              {moreUtilities ? (
                <div className={cn("mt-3 border-t border-border/70 pt-2", !overflowItems.length && "mt-1 border-t-0 pt-0")}>
                  {moreUtilities}
                </div>
              ) : null}
            </SheetContent>
          </Sheet>
        ) : null}
      </div>
    </nav>
  );
}
