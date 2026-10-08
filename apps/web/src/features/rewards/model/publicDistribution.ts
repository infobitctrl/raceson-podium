import type {PublicSponsorCampaign, PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
export type DistributionNode = {id: string; label: string; amountWei: bigint; level: 'pool' | 'allocation' | 'category' | 'winner' | 'reserve'; status?: 'claimed' | 'unclaimed' | 'planned'; children: DistributionNode[]; reference?: string; rank?:number|null};
/** Existing saved display labels use an explicit track/category separator. Keep
 * unsplit categories (including combined clubs) separate; never infer a track
 * from amounts, ordering, athlete names or a storage slot. */
export function publicTrackGroups(groups: PublicSponsorCampaign['pots'][number]['groups']) {
  const tracks = new Map<string, {label: string; amountWei: bigint; groups: typeof groups}>();
  for (const group of groups) {
    const parts = group.name.split(' · '), label = parts.length > 1 ? parts[0]!.trim() : group.name;
    const track = tracks.get(label) ?? {label, amountWei: 0n, groups: []};
    track.amountWei += BigInt(group.amountWei); track.groups.push(group); tracks.set(label, track);
  }
  return [...tracks.values()];
}
export function publicDistributionTree(campaign: PublicSponsorCampaign, pot: PublicSponsorCampaign['pots'][number], rows: PublicRewardPage['rows'] | null, hr: boolean): DistributionNode {
  const t = (en: string, local: string) => hr ? local : en;
  const trackNodes = (p: typeof pot): DistributionNode[] => publicTrackGroups(p.groups).map((track, ti) => ({
    id: `pot-${p.slot}-track-${ti}`, label: track.label, amountWei: track.amountWei, level: 'allocation', children: track.groups.map((g, gi) => {
      const id = `pot-${p.slot}-track-${ti}-category-${gi}`;
      const known = p.slot === pot.slot && rows !== null && rows.length > 0 && rows.every(r => r.breakdown !== undefined);
      const winners: DistributionNode[] = known ? rows.flatMap(row => (row.breakdown ?? []).filter(b => b.category === g.name).map(b => ({
        id: `${id}-${row.id}`, label: `${b.place ? `#${b.place} · ` : ''}${row.kind === 'club' ? t('Club', 'Klub') : t('Winner', 'Dobitnik')} ${row.number}`,
        amountWei: BigInt(b.amountWei), level: 'winner' as const, status: row.status, reference: row.id, rank:b.place, children: [],
      }))) : [];
      winners.sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||a.id.localeCompare(b.id));
      const awarded = winners.reduce((n, w) => n + w.amountWei, 0n), budget = BigInt(g.amountWei);
      // Preserve funds without a winning allocation; they are neither unpaid awards nor returned money.
      if (known && budget > awarded) winners.push({id: `${id}-reserve`, label: t('Unallocated', 'Neraspoređeno'), amountWei: budget - awarded, level: 'reserve', children: []});
      return {id, label: g.name.split(' · ').slice(1).join(' · ') || g.name, amountWei: budget, level: 'category', children: winners};
    }),
  }));
  return {id: 'pool', label: campaign.pots.length === 1 ? t('Prize pool', 'Fond nagrada') : t('Campaign pool', 'Fond kampanje'), amountWei: BigInt(campaign.budgetWei), level: 'pool', children:
    campaign.pots.length === 1 ? trackNodes(pot) : campaign.pots.map(p => ({id: `pot-${p.slot}`, label: p.slot === 0 ? t('League', 'Liga') : p.name, amountWei: BigInt(p.amountWei), level: 'allocation', children: trackNodes(p)}))};
}
export type RewardSort = 'reference' | 'reward' | 'amount' | 'status';
export function sortPublicRewards(rows: PublicRewardPage['rows'], sort: RewardSort, descending: boolean, hr = false) {
  const reward = (r: typeof rows[number]) => r.breakdown?.map(b => b.category).join(' · ') ?? (r.kind==='athlete' ? hr?'Nagrada sportaša':'Athlete reward' : hr?'Nagrada kluba':'Club reward');
  const status=(r:typeof rows[number])=>({claimed:hr?'Preuzeto':'Claimed',unclaimed:hr?'Nepreuzeto':'Unclaimed',planned:hr?'Planirano':'Planned'})[r.status];
  return [...rows].sort((a,b) => {
    const n = sort === 'amount' ? (BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : BigInt(a.amountWei) > BigInt(b.amountWei) ? 1 : 0)
      : sort === 'status' ? status(a).localeCompare(status(b),hr?'hr':'en') : sort === 'reward' ? reward(a).localeCompare(reward(b),hr?'hr':'en') || a.number-b.number : a.id.localeCompare(b.id);
    return (descending ? -n : n) || a.number-b.number;
  });
}
