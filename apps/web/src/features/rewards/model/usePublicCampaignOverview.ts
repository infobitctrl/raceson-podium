import {useEffect, useState} from 'react';
import type {PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import type {PublicCampaignSnapshot} from '@raceson/domain/rewards/public-directory';
import {ApiError} from '@/lib/api';
import {readPublicCampaign, readPublicCampaignSnapshot} from '../data/publicCampaign';

type Overview = {
  id: string; refresh: number; campaign: PublicSponsorCampaign | null;
  selection: PublicCampaignSnapshot['selection']; busy: boolean;
  failure: 'missing' | 'unavailable' | null; live: boolean; anchor?: {blockNumber: string; receivedAt: number};
};
const empty = (id: string, refresh: number): Overview => ({id, refresh, campaign: null, selection: null, busy: true, failure: null, live: false});

/** Published details can render while the independent live observation runs. */
export function usePublicCampaignOverview(id: string, refresh: number) {
  const [stored, setStored] = useState<Overview>(() => empty(id, refresh));
  useEffect(() => {
    const abort = new AbortController();
    setStored(previous => ({...empty(id, refresh), ...(previous.id === id ? {
      campaign: previous.campaign, selection: previous.selection, live: previous.live,
    } : {})}));
    void readPublicCampaignSnapshot(id, abort.signal).then(snapshot => {
      if (!abort.signal.aborted) setStored(previous => ({...previous,
        selection: snapshot.selection,
        campaign: previous.failure === 'missing' ? null : previous.campaign ?? snapshot.campaign,
      }));
    }).catch(() => {/* Live verification remains usable if the published summary is unavailable. */});
    void readPublicCampaign(id, abort.signal).then(campaign => {
      if (!abort.signal.aborted) setStored(previous => ({...previous, campaign, busy: false, live: true, anchor: {blockNumber: campaign.blockNumber, receivedAt: Date.now()}}));
    }).catch(error => {
      if (!abort.signal.aborted) setStored(previous => {
        const missing = error instanceof ApiError && error.status === 404;
        return {...previous, campaign: missing ? null : previous.campaign, busy: false,
          failure: missing ? 'missing' : 'unavailable', anchor: undefined};
      });
    });
    return () => abort.abort();
  }, [id, refresh]);
  if (stored.id !== id) return empty(id, refresh);
  return stored.refresh === refresh ? stored : {...stored, busy: true, anchor: undefined};
}
