import type { OrganizerManagedTrack, OrganizerManagedTrackSummary } from "@/lib/organizer-management";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";

export function resolveOrganizerTrackMedia<T extends OrganizerManagedTrack | OrganizerManagedTrackSummary>(track: T): T {
  return {
    ...track,
    galleryPreviewImageUrl: resolveRecoveredPublicMediaUrl(track.galleryPreviewImageUrl),
    ...("galleryItems" in track ? {
      galleryItems: track.galleryItems.map((item) => ({
        ...item,
        imageUrl: resolveRecoveredPublicMediaUrl(item.imageUrl) ?? item.imageUrl,
      })),
    } : {}),
  };
}
