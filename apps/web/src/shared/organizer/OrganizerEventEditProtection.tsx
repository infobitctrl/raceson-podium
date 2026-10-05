import { LockKeyhole, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import {
  lockOrganizerEventWorkspace,
  unlockOrganizerEventWorkspace,
} from "@/shared/organizer/eventWorkspaceUnlock";
import { useOrganizerEventWorkspaceUnlocked } from "@/shared/organizer/useEventWorkspaceUnlock";

export function OrganizerEventEditProtection({
  eventEditionId,
  finished,
  canManage,
  className,
}: {
  eventEditionId: string;
  finished: boolean;
  canManage: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const unlocked = useOrganizerEventWorkspaceUnlocked(eventEditionId);

  if (!finished || !canManage) return null;

  const toggleProtection = () => {
    if (unlocked) {
      lockOrganizerEventWorkspace(eventEditionId);
      toast.success(t("organizer.raceWorkspace.lockedToast"));
      return;
    }

    unlockOrganizerEventWorkspace(eventEditionId);
    toast.success(t("organizer.raceWorkspace.unlockedToast"));
  };

  const Icon = unlocked ? LockOpen : LockKeyhole;
  const status = unlocked
    ? t("organizer.raceWorkspace.unlocked")
    : t("organizer.raceWorkspace.locked");

  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
        <Icon
          className={cn("h-4 w-4 shrink-0", unlocked ? "text-primary" : "text-trail-amber")}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-foreground">
            {status}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {t("organizer.raceWorkspace.protectionDescription")}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleProtection}
        aria-label={unlocked
          ? t("organizer.raceWorkspace.relockAria")
          : t("organizer.raceWorkspace.unlockAria")}
        className={cn(
          "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          unlocked
            ? "border border-border bg-background text-foreground hover:bg-muted/60"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {unlocked ? <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> : <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />}
        {unlocked
          ? t("organizer.raceWorkspace.relock")
          : t("organizer.raceWorkspace.unlock")}
      </button>
    </div>
  );
}
