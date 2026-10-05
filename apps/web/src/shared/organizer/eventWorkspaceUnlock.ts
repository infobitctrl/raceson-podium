const EVENT_WORKSPACE_UNLOCK_PREFIX = "sitrail.organizer.event-workspace-unlocked.v1:";
const EVENT_WORKSPACE_SHARED_UNLOCK_PREFIX = "sitrail.organizer.event-workspace-shared-unlocked.v1:";
const EVENT_WORKSPACE_UNLOCK_CHANGED = "sitrail:organizer-event-workspace-unlock-changed";
const EVENT_WORKSPACE_UNLOCK_DURATION_MS = 12 * 60 * 60 * 1_000;

type EventWorkspaceUnlockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type EventWorkspaceUnlockChange = {
  eventEditionId: string;
};

function browserSessionStorage(): EventWorkspaceUnlockStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserLocalStorage(): EventWorkspaceUnlockStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function organizerEventWorkspaceUnlockKey(eventEditionId: string) {
  return `${EVENT_WORKSPACE_UNLOCK_PREFIX}${encodeURIComponent(eventEditionId)}`;
}

function organizerEventWorkspaceSharedUnlockKey(eventEditionId: string) {
  return `${EVENT_WORKSPACE_SHARED_UNLOCK_PREFIX}${encodeURIComponent(eventEditionId)}`;
}

function sharedBrowserUnlockIsActive(
  eventEditionId: string,
  storage: EventWorkspaceUnlockStorage | null = browserLocalStorage(),
) {
  if (!storage) return false;
  try {
    const key = organizerEventWorkspaceSharedUnlockKey(eventEditionId);
    const expiresAt = Number(storage.getItem(key));
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return true;
    storage.removeItem(key);
    return false;
  } catch {
    return false;
  }
}

function notifyOrganizerEventWorkspaceUnlockChanged(eventEditionId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EventWorkspaceUnlockChange>(
    EVENT_WORKSPACE_UNLOCK_CHANGED,
    { detail: { eventEditionId } },
  ));
}

export function subscribeToOrganizerEventWorkspaceUnlock(
  eventEditionId: string | null | undefined,
  onChange: () => void,
) {
  if (typeof window === "undefined" || !eventEditionId) return () => undefined;

  const handleChange = (event: Event) => {
    if (event.type === "storage") {
      const storageEvent = event as StorageEvent;
      if (
        storageEvent.key === organizerEventWorkspaceUnlockKey(eventEditionId)
        || storageEvent.key === organizerEventWorkspaceSharedUnlockKey(eventEditionId)
      ) {
        onChange();
      }
      return;
    }

    const changedEventId = (event as CustomEvent<EventWorkspaceUnlockChange>).detail?.eventEditionId;
    if (changedEventId === eventEditionId) onChange();
  };

  window.addEventListener(EVENT_WORKSPACE_UNLOCK_CHANGED, handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(EVENT_WORKSPACE_UNLOCK_CHANGED, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

export function organizerEventWorkspaceIsUnlocked(
  eventEditionId: string | null | undefined,
  storage?: EventWorkspaceUnlockStorage | null,
) {
  if (!eventEditionId) return false;
  const sessionStorage = storage === undefined ? browserSessionStorage() : storage;
  try {
    if (sessionStorage?.getItem(organizerEventWorkspaceUnlockKey(eventEditionId)) === "1") {
      return true;
    }
  } catch {
    // Fall through to the same-browser editing window when session storage is unavailable.
  }
  return storage === undefined && sharedBrowserUnlockIsActive(eventEditionId);
}

export function unlockOrganizerEventWorkspace(
  eventEditionId: string,
  storage?: EventWorkspaceUnlockStorage | null,
) {
  if (!eventEditionId) return;
  const sessionStorage = storage === undefined ? browserSessionStorage() : storage;
  const wasUnlocked = organizerEventWorkspaceIsUnlocked(eventEditionId, storage);
  try {
    sessionStorage?.setItem(organizerEventWorkspaceUnlockKey(eventEditionId), "1");
  } catch {
    // Keep the current screen usable when browser storage is unavailable.
  }
  if (storage === undefined) {
    try {
      browserLocalStorage()?.setItem(
        organizerEventWorkspaceSharedUnlockKey(eventEditionId),
        String(Date.now() + EVENT_WORKSPACE_UNLOCK_DURATION_MS),
      );
    } catch {
      // The session marker still keeps the current tab unlocked.
    }
  }
  if (!wasUnlocked) notifyOrganizerEventWorkspaceUnlockChanged(eventEditionId);
}

export function lockOrganizerEventWorkspace(
  eventEditionId: string,
  storage?: EventWorkspaceUnlockStorage | null,
) {
  if (!eventEditionId) return;
  const sessionStorage = storage === undefined ? browserSessionStorage() : storage;
  const wasUnlocked = organizerEventWorkspaceIsUnlocked(eventEditionId, storage);
  try {
    sessionStorage?.removeItem(organizerEventWorkspaceUnlockKey(eventEditionId));
  } catch {
    // The event will still return to its default locked state on the next mount.
  }
  if (storage === undefined) {
    try {
      browserLocalStorage()?.removeItem(organizerEventWorkspaceSharedUnlockKey(eventEditionId));
    } catch {
      // The current tab marker was still removed when session storage was available.
    }
  }
  if (wasUnlocked) notifyOrganizerEventWorkspaceUnlockChanged(eventEditionId);
}
