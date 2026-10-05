/** Shared per-process read start budget for the fixed public Monad endpoint.
 * No retries, cache, signing or send queue. Queued requests remain abortable;
 * slow responses cannot accumulate unlimited in-flight network requests. */
export function createTestnetReadPacer(gapMs = 125, concurrency = 8) {
  let next = 0, running = 0;
  const queue: { signal: AbortSignal; resolve: (release: () => void) => void; reject: () => void; abort: () => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  function pump() {
    if (timer || running >= concurrency || !queue.length) return;
    const wait = Math.max(0, next - Date.now());
    if (wait) { timer = setTimeout(() => { timer = undefined; pump(); }, wait); return; }
    const item = queue.shift()!;
    item.signal.removeEventListener("abort", item.abort);
    if (item.signal.aborted) { item.reject(); pump(); return; }
    next = Date.now() + gapMs; running++;
    let released = false;
    item.resolve(() => { if (!released) { released = true; running--; pump(); } });
    pump();
  }
  return (signal: AbortSignal): Promise<() => void> => new Promise((resolve, reject) => {
    if (signal.aborted || queue.length >= 256) { reject(Error("reward_read_queue_unavailable")); return; }
    const item = { signal, resolve, reject: () => reject(Error("reward_read_queue_unavailable")), abort: () => {} };
    item.abort = () => { const i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1); item.reject(); pump(); };
    signal.addEventListener("abort", item.abort, { once: true }); queue.push(item); pump();
  });
}
export const acquireTestnetRead = createTestnetReadPacer();
