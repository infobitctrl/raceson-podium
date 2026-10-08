import {useEffect, useState} from 'react';
import {PUBLIC_REWARD_PAGE_SIZE, type PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {readPublicRewards} from '../data/publicCampaign';
export type PublicCampaignRewards = {page: PublicRewardPage | null; busy: boolean; failed: boolean; retry: () => void};
/** Fetch bounded public pages once for both the diagram and global ledger sorting.
 * Never show a partial collection as a complete distribution. Each page retains
 * the server's finalized verification; the oldest timestamp describes the view. */
export function usePublicCampaignRewards(id: string, slot: number, refresh: number, enabled = true): PublicCampaignRewards {
  const [stored, setStored] = useState<{id:string;slot:number;page:PublicRewardPage}|null>(null);
  const [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setBusy(true); setFailed(false); setStored(null);
    void (async () => {
      const first = await readPublicRewards(id, slot, 0, 'reward', 'asc', abort.signal);
      const rows = [...first.rows];
      for (let offset = PUBLIC_REWARD_PAGE_SIZE; offset < first.total; offset += PUBLIC_REWARD_PAGE_SIZE) {
        const next = await readPublicRewards(id, slot, offset, 'reward', 'asc', abort.signal);
        if (next.total !== first.total || next.availability !== first.availability) throw Error('public_rewards_changed');
        rows.push(...next.rows);
      }
      if (rows.length !== first.total || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('public_rewards_changed');
      if (!abort.signal.aborted) setStored({id,slot,page:{...first, rows}});
    })().catch(() => {if (!abort.signal.aborted) setFailed(true);}).finally(() => {if (!abort.signal.aborted) setBusy(false);});
    return () => abort.abort();
  }, [id, slot, refresh, attempt, enabled]);
  return {page:stored?.id===id&&stored.slot===slot?stored.page:null, busy, failed, retry: () => setAttempt(n => n + 1)};
}
