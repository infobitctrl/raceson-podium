import { useCallback, useSyncExternalStore } from "react";
import {
  organizerEventWorkspaceIsUnlocked,
  subscribeToOrganizerEventWorkspaceUnlock,
} from "@/shared/organizer/eventWorkspaceUnlock";

export function useOrganizerEventWorkspaceUnlocked(
  eventEditionId: string | null | undefined,
) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToOrganizerEventWorkspaceUnlock(
      eventEditionId,
      onStoreChange,
    ),
    [eventEditionId],
  );
  const getSnapshot = useCallback(
    () => organizerEventWorkspaceIsUnlocked(eventEditionId),
    [eventEditionId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
