import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BrandNavbarLockup } from "@/shared/brand/BrandNavbarLockup";
import { WorkspaceSwitcher } from "@/shared/navigation/WorkspaceSwitcher";

type MobileWorkspaceTopBarProps = {
  inverted?: boolean;
  trailingAction?: ReactNode;
  className?: string;
  publicHomePath?: string;
  publicHomeImageSrc?: string;
  publicHomeLogo?: ReactNode;
};

export function MobileWorkspaceTopBar({
  inverted = false,
  trailingAction,
  className,
  publicHomePath = "/",
  publicHomeImageSrc,
  publicHomeLogo,
}: MobileWorkspaceTopBarProps) {
  return (
    <div
      data-mobile-workspace-top-bar
      className={cn("flex h-16 min-w-0 items-center justify-between gap-2 px-3", className)}
    >
      <WorkspaceSwitcher
        variant="mobile"
        inverted={inverted}
        publicHomePath={publicHomePath}
        publicHomeImageSrc={publicHomeImageSrc}
        publicHomeLogo={publicHomeLogo ?? (
          <BrandNavbarLockup
            decorative
            eager
            onLight={!inverted}
            className="h-3.5 max-w-full gap-0.5"
          />
        )}
      />
      <div className="flex shrink-0 items-center gap-1"><NotificationBell inverted={inverted} />{trailingAction}</div>
    </div>
  );
}
