const PUBLIC_PARTICIPANT_REQUEST_TTL_MS = 15_000;

type ParticipantRequestEntry = {
  expiresAt: number;
  promise: Promise<unknown>;
};

const participantRequests = new Map<string, ParticipantRequestEntry>();

export function loadDedupedPublicEventParticipants<T>(
  editionId: string,
  loader: () => PromiseLike<T> | T,
  now = Date.now(),
) {
  const cached = participantRequests.get(editionId);
  if (cached && cached.expiresAt > now) {
    return cached.promise as Promise<T>;
  }

  const promise = Promise.resolve().then(loader);
  participantRequests.set(editionId, {
    expiresAt: now + PUBLIC_PARTICIPANT_REQUEST_TTL_MS,
    promise,
  });

  void promise.catch(() => {
    if (participantRequests.get(editionId)?.promise === promise) {
      participantRequests.delete(editionId);
    }
  });

  return promise;
}

export function resetPublicParticipantRequestCache() {
  participantRequests.clear();
}
