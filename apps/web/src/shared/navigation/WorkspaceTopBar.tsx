import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { Link } from "react-router-dom";
import { BrandNavbarLockup } from "@/shared/brand/BrandNavbarLockup";
import { DesktopPublicNavigation } from "@/shared/navigation/DesktopPublicNavigation";
import { DesktopUtilityMenu } from "@/shared/navigation/DesktopUtilityMenu";
import { WorkspaceSwitcher } from "@/shared/navigation/WorkspaceSwitcher";
import { useI18n } from "@/shared/i18n/I18nContext";

type WorkspaceTopBarProps = {
  sidebar: "athlete" | "organizer";
  onSignOut?: () => void | Promise<void>;
};

export function WorkspaceTopBar({ sidebar, onSignOut }: WorkspaceTopBarProps) {
  const { t } = useI18n();
  return (
    <header
      aria-label={t("workspace.header", {
        role: sidebar === "athlete" ? t("common.athlete") : t("common.organizer"),
      })}
      className="hidden h-14 shrink-0 border-b border-white/10 bg-[hsl(207_33%_6%_/_0.96)] text-white shadow-[0_20px_48px_-30px_rgba(15,23,42,0.82)] lg:flex"
    >
      <div className="container mx-auto flex h-full w-full items-center justify-between px-4">
        <Link
          to="/"
          aria-label={t("workspace.openPublic")}
          className="flex h-full shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <BrandNavbarLockup className="h-6 xl:h-7" eager />
        </Link>

        <DesktopPublicNavigation />

        <div className="flex items-center gap-1.5">
          <NotificationBell inverted />
          <WorkspaceSwitcher variant="desktop" inverted />
          <DesktopUtilityMenu inverted onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}
