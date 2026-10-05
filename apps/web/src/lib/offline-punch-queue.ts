import { ApiError } from "@/lib/api";

export type DirectQueuedPunchPayload = {
  timingSessionId: string;
  checkpointId: string;
  clientEventId: string;
  recordedAt: string;
  registrationId?: string | null;
  bibNumber?: string | null;
};

export type SharedQueuedPunchPayload = {
  eventEditionId: string;
  checkpointIds: string[];
  clientEventId: string;
  recordedAt: string;
  bibNumber: string;
};

export type QueuedPunchPayload =
  | DirectQueuedPunchPayload
  | SharedQueuedPunchPayload;

export function isSharedQueuedPunch(
  payload: QueuedPunchPayload,
): payload is SharedQueuedPunchPayload {
  return "checkpointIds" in payload;
}

export type QueuedPunch = {
  editionId: string;
  payload: QueuedPunchPayload;
  queuedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
};

export function shouldSavePunchOnDevice(
  error: unknown,
  deviceIsOnline = typeof navigator === "undefined" || navigator.onLine,
) {
  return (
    !deviceIsOnline
    || error instanceof TypeError
    || (error instanceof ApiError && error.status >= 500)
  );
}

const DATABASE_NAME = "sitrail-race-ops-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-punches";

function requireIndexedDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("Offline storage is unavailable on this device");
  }
  return indexedDB;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = requireIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline queue"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "payload.clientEventId",
        });
        store.createIndex("editionId", "editionId", { unique: false });
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline queue transaction aborted"));
      action(store, resolve, reject);
    });
  } finally {
    database.close();
  }
}

export function enqueueOfflinePunch(editionId: string, payload: QueuedPunchPayload) {
  const item: QueuedPunch = {
    editionId,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };
  return withStore<QueuedPunch>("readwrite", (store, resolve, reject) => {
    const request = store.put(item);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(item);
  });
}

export function listOfflinePunches(editionId?: string) {
  return withStore<QueuedPunch[]>("readonly", (store, resolve, reject) => {
    const request = editionId
      ? store.index("editionId").getAll(IDBKeyRange.only(editionId))
      : store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const items = (request.result as QueuedPunch[]).sort(
        (left, right) => left.queuedAt.localeCompare(right.queuedAt),
      );
      resolve(items);
    };
  });
}

export function removeOfflinePunch(clientEventId: string) {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(clientEventId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export function recordOfflinePunchFailure(item: QueuedPunch, error: unknown) {
  const updated: QueuedPunch = {
    ...item,
    attempts: item.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : "Sync failed",
  };
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(updated);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function syncOfflinePunches(
  editionId: string,
  send: (payload: QueuedPunchPayload) => Promise<unknown>,
  shouldRetry: (error: unknown) => boolean,
) {
  const queued = await listOfflinePunches(editionId);
  let synced = 0;
  let failed = 0;

  for (const item of queued) {
    try {
      await send(item.payload);
      await removeOfflinePunch(item.payload.clientEventId);
      synced += 1;
    } catch (error) {
      await recordOfflinePunchFailure(item, error);
      failed += 1;
      if (shouldRetry(error)) break;
    }
  }

  return {
    queued: queued.length,
    synced,
    failed,
    remaining: (await listOfflinePunches(editionId)).length,
  };
}
