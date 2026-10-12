import {useEffect, useState} from 'react';
import type {PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {freshRewardAnchor, freshRewardPage, loadCachedRewardCollection, readRewardCollection, rewardCacheKey, type PublicRewardAnchor, type PublicRewardCache} from './publicRewardCollection';
export type {PublicRewardAnchor, PublicRewardCache} from './publicRewardCollection';
export type PublicCampaignRewards = {page: PublicRewardPage | null; busy: boolean; failed: boolean; retry: () => void};

/** Display complete snapshots immediately; revalidate stale rounds in the background. */
export function usePublicCampaignRewards(id: string, slot: number, refresh: number, enabled = true, cache?: PublicRewardCache, anchor?: PublicRewardAnchor, nextSlot?: number): PublicCampaignRewards {
  const key = rewardCacheKey(id, slot);
  const [stored, setStored] = useState<{id:string;slot:number;page:PublicRewardPage}|null>(() => {
    const saved = cache?.get(key);
    return saved ? {id, slot, page: saved.page} : null;
  });
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let current = true;
    setBusy(!(attempt === 0 && cache && freshRewardPage(cache, id, slot, refresh))); setFailed(false);
    const saved = cache?.get(key);
    const initialBlock = attempt === 0 && saved?.refresh !== refresh ? freshRewardAnchor(anchor) : undefined;
    const loading = cache ? loadCachedRewardCollection(cache, id, slot, refresh, initialBlock, attempt > 0)
      : readRewardCollection(id, slot, abort.signal, initialBlock);
    void loading.then(page => {
      if (!current) return;
      setStored({id, slot, page});
      // Warm only the next round, after the selected round is complete. This
      // shares the recent campaign observation and never blocks the visible view.
      const block = freshRewardAnchor(anchor);
      if (cache && nextSlot !== undefined && nextSlot !== slot && block && attempt === 0
        && cache.get(rewardCacheKey(id, nextSlot))?.refresh !== refresh)
        void loadCachedRewardCollection(cache, id, nextSlot, refresh, block).catch(() => {});
    }).catch(() => {
      abort.abort();
      if (current) setFailed(true);
    }).finally(() => {if (current) setBusy(false);});
    // Screen-owned cached requests survive a round switch so the next click can
    // join a preload. The screen cancels them on refresh, campaign change/unmount.
    return () => {current = false; if (!cache) abort.abort();};
  }, [id, slot, key, refresh, attempt, enabled, cache, anchor, nextSlot]);
  return {page:stored?.id===id&&stored.slot===slot?stored.page:cache?.get(key)?.page??null, busy, failed, retry: () => setAttempt(n => n + 1)};
}
