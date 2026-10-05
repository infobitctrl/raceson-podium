import type { OrganizerManagedEvent, OrganizerManagedEventSummary } from "@/lib/organizer-management";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";

export function resolveOrganizerEventMedia<T extends OrganizerManagedEvent | OrganizerManagedEventSummary>(event: T): T {
  return {
    ...event,
    coverImageUrl: resolveRecoveredPublicMediaUrl(event.coverImageUrl),
    ...("categories" in event ? {
      categories: event.categories.map((category) => ({
        ...category,
        coverImageUrl: resolveRecoveredPublicMediaUrl(category.coverImageUrl),
      })),
    } : {}),
  };
}
