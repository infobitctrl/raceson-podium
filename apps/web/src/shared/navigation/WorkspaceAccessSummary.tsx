import { CheckCircle2, Flag, Footprints, Globe2, Layers3, LockKeyhole } from "lucide-react";
import { hasOrganizerWorkspaceAccess, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { MobileDetailDisclosure } from "@/shared/mobile/MobileDetailDisclosure";

export function WorkspaceAccessSummary({ className }: { className?: string }) {
  const { t } = useI18n();
  const { user, account } = useAuth();
  if (!user) return null;

  const spaces = [
    { label: t("common.public"), enabled: true, icon: Globe2 },
    { label: t("common.athlete"), enabled: Boolean(account?.hasAthleteAccess), icon: Footprints },
    { label: t("common.organizer"), enabled: hasOrganizerWorkspaceAccess(account), icon: Flag },
  ];
  const enabledSpaceLabels = spaces
    .filter((space) => space.enabled)
    .map((space) => space.label)
    .join(" · ");

  return (
    <MobileDetailDisclosure
      title={t("workspace.accessSummary.title")}
      summary={enabledSpaceLabels}
      icon={Layers3}
      hideOnDesktop={false}
      className={cn("border-border bg-card", className)}
    >
      <p className="text-xs leading-5 text-muted-foreground">{t("workspace.accessSummary.description")}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {spaces.map(({ label, enabled, icon: Icon }) => (
          <div
            key={label}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 text-center",
              enabled ? "border-border/80 bg-muted/35 text-foreground" : "border-border/60 bg-muted/15 text-muted-foreground/55",
            )}
          >
            <span className="flex items-center gap-1.5">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {enabled
                ? <CheckCircle2 className="h-3.5 w-3.5 text-trail-green" aria-label={t("workspace.accessSummary.enabled")} />
                : <LockKeyhole className="h-3.5 w-3.5" aria-label={t("workspace.accessSummary.disabled")} />}
            </span>
            <span className="truncate text-[11px] font-bold">{label}</span>
          </div>
        ))}
      </div>
    </MobileDetailDisclosure>
  );
}
