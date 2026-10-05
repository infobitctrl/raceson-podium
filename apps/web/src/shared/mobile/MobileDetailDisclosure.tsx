import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type MobileDetailDisclosureProps = {
  title: string;
  summary: string;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
  defaultOpen?: boolean;
  expandOnDesktop?: boolean;
  hideOnDesktop?: boolean;
  hideSummaryOnDesktop?: boolean;
};

export function MobileDetailDisclosure({
  title,
  summary,
  children,
  icon: Icon,
  className,
  defaultOpen = false,
  expandOnDesktop = false,
  hideOnDesktop = true,
  hideSummaryOnDesktop = false,
}: MobileDetailDisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!expandOnDesktop || typeof window.matchMedia !== "function") return undefined;
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const syncOpenState = () => setIsOpen(desktopQuery.matches || defaultOpen);
    syncOpenState();
    desktopQuery.addEventListener("change", syncOpenState);
    return () => desktopQuery.removeEventListener("change", syncOpenState);
  }, [defaultOpen, expandOnDesktop]);

  return (
    <details
      className={cn(
        "group overflow-hidden rounded-2xl border border-border/75 bg-card shadow-soft",
        hideOnDesktop && "lg:hidden",
        className,
      )}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className={cn(
        "flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
        hideSummaryOnDesktop && "lg:hidden",
      )}>
        {Icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.09] text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span role="heading" aria-level={2} className="block font-display text-sm font-bold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={cn(
        "border-t border-border/70 px-4 py-4",
        hideSummaryOnDesktop && "lg:border-t-0 lg:p-0",
      )}>{children}</div>
    </details>
  );
}
