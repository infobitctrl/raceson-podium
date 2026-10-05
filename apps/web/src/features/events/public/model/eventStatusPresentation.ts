import type { PortalEventCatalogItem } from "@/lib/portal-read-models";
import type { TranslationKey } from "@/shared/i18n/messages";

export type PublicRaceLifecycleStatus = "open" | "ongoing" | "finished";

export function getPublicRaceLifecycleStatus(
  status: string | null | undefined,
): PublicRaceLifecycleStatus {
  const normalized = (status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (["completed", "archived", "finished"].includes(normalized)) return "finished";
  if (["in_progress", "live", "ongoing"].includes(normalized)) return "ongoing";
  return "open";
}

export function getPublicRaceLifecycleLabel(
  status: string | null | undefined,
) {
  const lifecycle = getPublicRaceLifecycleStatus(status);
  if (lifecycle === "finished") return "Finished";
  if (lifecycle === "ongoing") return "Ongoing";
  return "Open";
}

export function getPublicRaceLifecycleLabelKey(
  status: string | null | undefined,
): TranslationKey {
  const lifecycle = getPublicRaceLifecycleStatus(status);
  if (lifecycle === "finished") return "event.card.status.finished";
  if (lifecycle === "ongoing") return "event.card.status.ongoing";
  return "event.card.status.registrationOpen";
}

export function getEventImageStatusClasses(status: PortalEventCatalogItem["status"]) {
  const lifecycle = getPublicRaceLifecycleStatus(status);
  if (lifecycle === "open") return "timing-lime-pill";
  if (lifecycle === "ongoing") return "border-trail-red/40 bg-trail-red/90 text-white ring-1 ring-trail-red/25 dark:text-trail-red-foreground";
  return "border-primary/40 bg-primary text-primary-foreground ring-1 ring-primary/25 shadow-warm";
}
