import {PUBLIC_REWARD_FETCH_SIZE, type PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {readPublicRewards} from '../data/publicCampaign';

/** Completed public collections only; owned by one campaign screen, never persisted. */
export type PublicRewardCache = Map<string, {page: PublicRewardPage; refresh: number; receivedAt?: number}>;
export type PublicRewardAnchor = {blockNumber: string; receivedAt: number};
const FRESH_MS = 30_000, ANCHOR_MS = 90_000, PAGE_CONCURRENCY = 4;
export const rewardCacheKey = (id: string, slot: number) => `${id}:${slot}`;
export const freshRewardAnchor = (anchor?: PublicRewardAnchor) => anchor && Date.now() - anchor.receivedAt >= 0 && Date.now() - anchor.receivedAt < ANCHOR_MS ? anchor.blockNumber : undefined;
export function freshRewardPage(cache: PublicRewardCache, id: string, slot: number, refresh: number) {
  const saved = cache.get(rewardCacheKey(id, slot));
  return saved?.refresh === refresh && saved.receivedAt !== undefined && Date.now() - saved.receivedAt >= 0 && Date.now() - saved.receivedAt < FRESH_MS ? saved.page : undefined;
}

/** Every page must belong to one complete, finalized snapshot. */
export async function readRewardCollection(id: string, slot: number, signal: AbortSignal, block?: string): Promise<PublicRewardPage> {
  const first = await readPublicRewards(id, slot, 0, 'reward', 'asc', signal, block, PUBLIC_REWARD_FETCH_SIZE);
  signal.throwIfAborted();
  const pages = [first];
  let nextOffset = PUBLIC_REWARD_FETCH_SIZE;
  async function worker() {
    while (nextOffset < first.total) {
      signal.throwIfAborted();
      const offset = nextOffset;
      nextOffset += PUBLIC_REWARD_FETCH_SIZE;
      const next = await readPublicRewards(id, slot, offset, 'reward', 'asc', signal, first.blockNumber, PUBLIC_REWARD_FETCH_SIZE);
      signal.throwIfAborted();
      if (next.total !== first.total || next.availability !== first.availability
        || next.blockNumber !== first.blockNumber || next.blockTimestamp !== first.blockTimestamp) throw Error('public_rewards_changed');
      pages[offset / PUBLIC_REWARD_FETCH_SIZE] = next;
    }
  }
  await Promise.all(Array.from({length: Math.min(PAGE_CONCURRENCY, Math.ceil(first.total / PUBLIC_REWARD_FETCH_SIZE) - 1)}, worker));
  const rows = pages.flatMap(page => page.rows);
  if (rows.length !== first.total || new Set(rows.map(row => row.id)).size !== rows.length
    || new Set(rows.map(row => row.number)).size !== rows.length) throw Error('public_rewards_changed');
  return {...first, rows};
}

type Pending = {id: string; refresh: number; controller: AbortController; promise: Promise<PublicRewardPage>};
const requests = new WeakMap<PublicRewardCache, Map<string, Pending>>();
/** A click joins an in-flight preload instead of cancelling and repeating it. */
export function loadCachedRewardCollection(cache: PublicRewardCache, id: string, slot: number, refresh: number, block?: string, force = false) {
  const key = rewardCacheKey(id, slot), fresh = force ? undefined : freshRewardPage(cache, id, slot, refresh);
  if (fresh) return Promise.resolve(fresh);
  const pending = requests.get(cache) ?? new Map<string, Pending>();
  requests.set(cache, pending);
  const existing = pending.get(key);
  if (existing && existing.refresh === refresh && !force) return existing.promise;
  existing?.controller.abort();
  const controller = new AbortController();
  const promise = readRewardCollection(id, slot, controller.signal, block).then(page => {
    controller.signal.throwIfAborted();
    if (pending.get(key) === entry) {
      cache.delete(key);
      while (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(key, {page, refresh, receivedAt: Date.now()});
    }
    return page;
  }).catch(error => {controller.abort(); throw error;}).finally(() => {if (pending.get(key) === entry) pending.delete(key);});
  const entry: Pending = {id, refresh, controller, promise};
  pending.set(key, entry);
  return promise;
}

/** Stop only this screen/generation's requests; a newer refresh stays independent. */
export function cancelPublicRewardLoads(cache: PublicRewardCache, id: string, refresh: number) {
  const pending = requests.get(cache);
  for (const [key, entry] of pending ?? []) if (entry.id === id && entry.refresh === refresh) {
    entry.controller.abort(); pending!.delete(key);
  }
}
