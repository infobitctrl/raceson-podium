import { Home } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { publicPrimaryNavigationItems } from "@/shared/navigation/publicNavigation";

type DesktopPublicNavigationProps = {
  publicHomePath?: string;
  eventsPath?: string;
};

function isNavItemActive(path: string, pathname: string) {
  return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
}

export function DesktopPublicNavigation({
  publicHomePath = "/",
  eventsPath = "/events",
}: DesktopPublicNavigationProps) {
  const location = useLocation();
  const { t } = useI18n();

  return (
    <nav aria-label={t("nav.primary")} className="hidden items-center gap-0.5 lg:flex">
      {publicPrimaryNavigationItems.map((item) => {
        const itemPath = item.id === "events"
          ? eventsPath
          : item.path === "/" ? publicHomePath : item.path;
        const isActive = isNavItemActive(itemPath, location.pathname);

        return (
          <Link
            key={item.path}
            to={itemPath}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors hover:text-primary xl:px-3.5 xl:text-sm",
              isActive
                ? "text-white"
                : "text-white/[0.72] hover:bg-white/[0.06]",
            )}
          >
            {item.id === "home" ? <Home className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {t(item.labelKey)}
            {isActive ? (
              <span className="absolute bottom-0 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-primary" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
