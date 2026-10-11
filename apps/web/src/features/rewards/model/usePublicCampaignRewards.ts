import {useEffect, useState} from 'react';
import {PUBLIC_REWARD_PAGE_SIZE, type PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {readPublicRewards} from '../data/publicCampaign';
export type PublicCampaignRewards = {page: PublicRewardPage | null; busy: boolean; failed: boolean; retry: () => void};
const PAGE_CONCURRENCY = 4;
/** Load the diagram and ledger from one finalized block, with bounded concurrency.
 * An incomplete or inconsistent collection is never shown as a distribution. */
export function usePublicCampaignRewards(id: string, slot: number, refresh: number, enabled = true): PublicCampaignRewards {
  const [stored, setStored] = useState<{id:string;slot:number;page:PublicRewardPage}|null>(null);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let current = true;
    setBusy(true); setFailed(false); setStored(null);
    void (async () => {
      const first = await readPublicRewards(id, slot, 0, 'reward', 'asc', abort.signal);
      abort.signal.throwIfAborted();
      const pages = [first];
      let nextOffset = PUBLIC_REWARD_PAGE_SIZE;
      async function worker() {
        while (nextOffset < first.total) {
          abort.signal.throwIfAborted();
          const offset = nextOffset;
          nextOffset += PUBLIC_REWARD_PAGE_SIZE;
          const next = await readPublicRewards(id, slot, offset, 'reward', 'asc', abort.signal, first.blockNumber);
          abort.signal.throwIfAborted();
          if (next.total !== first.total || next.availability !== first.availability
            || next.blockNumber !== first.blockNumber || next.blockTimestamp !== first.blockTimestamp) throw Error('public_rewards_changed');
          pages[offset / PUBLIC_REWARD_PAGE_SIZE] = next;
        }
      }
      await Promise.all(Array.from({length: Math.min(PAGE_CONCURRENCY, Math.ceil(first.total / PUBLIC_REWARD_PAGE_SIZE) - 1)}, worker));
      const rows = pages.flatMap(page => page.rows);
      if (rows.length !== first.total || new Set(rows.map(r => r.id)).size !== rows.length
        || new Set(rows.map(r => r.number)).size !== rows.length) throw Error('public_rewards_changed');
      if (current) setStored({id,slot,page:{...first, rows}});
    })().catch(() => {
      abort.abort(); // Stop sibling requests and prevent further pages after a failure.
      if (current) setFailed(true);
    }).finally(() => {if (current) setBusy(false);});
    return () => {current = false; abort.abort();};
  }, [id, slot, refresh, attempt, enabled]);
  return {page:stored?.id===id&&stored.slot===slot?stored.page:null, busy, failed, retry: () => setAttempt(n => n + 1)};
}
