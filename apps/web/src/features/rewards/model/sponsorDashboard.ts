import type {SponsorChainObservation, SponsorPotObservation} from '@raceson/rewards-chain/sponsor-v4';

/** Presentation of finalized observations only; never evidence of reviewer approval. */
export function sponsorPotStatus(pot: SponsorPotObservation, observation: SponsorChainObservation, hr: boolean) {
  const t = (en: string, local: string) => hr ? local : en;
  if (pot.state === 5) return t('Cancelled', 'Otkazano');
  if (pot.state === 4) return t('Claim period ended', 'Rok preuzimanja završen');
  if (pot.paused) return t('Security pause', 'Sigurnosna pauza');
  if (pot.state === 3) return BigInt(pot.claimDeadline) <= BigInt(observation.blockTimestamp)
    ? t('Claim period ended', 'Rok preuzimanja završen') : t('Claims open', 'Preuzimanje otvoreno');
  if (pot.state === 2) return t('Allocation staged', 'Raspodjela pripremljena');
  return t('Waiting for approved results', 'Čeka odobrene rezultate');
}

export function sponsorCampaignStatus(observation: SponsorChainObservation, hr: boolean) {
  const statuses = [...new Set(observation.pots.map(p => sponsorPotStatus(p, observation, hr)))];
  if (statuses.length === 1) return statuses[0];
  if (observation.pots.some(p => p.paused && p.state < 4)) return hr ? 'Dio preuzimanja pauziran' : 'Some claims paused';
  if (observation.pots.some(p => p.state === 3 && BigInt(p.claimDeadline) > BigInt(observation.blockTimestamp))) return hr ? 'Preuzimanje otvoreno za dio fondova' : 'Claims open for some pots';
  return hr ? 'Fondovi u različitim fazama' : 'Reward pots at different stages';
}

export function sponsorAccounting(observation: SponsorChainObservation) {
  const sum = (field: 'paidWei' | 'remainingWei' | 'returnedWei') => observation.pots.reduce((n, p) => n + BigInt(p[field]), 0n);
  return {paid: sum('paidWei'), held: sum('remainingWei'), returned: sum('returnedWei')};
}

// Integer arithmetic before conversion; floating point never determines money.
export const sponsorChartPercent = (amount: bigint, total: bigint) => total > 0n ? Number(amount * 10000n / total) / 100 : 0;
