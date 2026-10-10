import {setupId} from './distribution-setup.js';
import {sponsorAddress, sponsorTxHash} from './sponsor-execution.js';

/** Public economics and contract accounting only; no owner, session or recipient records. */
export type PublicSponsorCampaign = {
  id: string; name: string; chainId: 10143 | 31337; budgetWei: string;
  address: string; fundingHash: string; blockNumber: string; blockTimestamp: string;
  pots: {slot: number; name: string; amountWei: string; state: number; paused: boolean;
    allocatedWei: string; paidWei: string; remainingWei: string; returnedWei: string; claimDeadline: string;
    groups: {name: string; amountWei: string}[];}[];
};
export function decodePublicSponsorCampaign(value: unknown): PublicSponsorCampaign {
  const fail = (): never => {throw Error('invalid_public_campaign');};
  const exact = (v: unknown, keys: string) => Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.split(',').sort().join());
  const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v);
  const name = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 300;
  if (!exact(value, 'id,name,chainId,budgetWei,address,fundingHash,blockNumber,blockTimestamp,pots')) return fail();
  const c = value as PublicSponsorCampaign;
  if (!setupId(c.id) || !name(c.name) || ![10143,31337].includes(c.chainId) || !sponsorAddress(c.address) || !sponsorTxHash(c.fundingHash)
    || ![c.budgetWei,c.blockNumber,c.blockTimestamp].every(uint) || BigInt(c.budgetWei) === 0n || !Array.isArray(c.pots) || !c.pots.length || c.pots.length > 6) return fail();
  const slots = new Set<number>();
  for (const p of c.pots) {
    if (!exact(p,'slot,name,amountWei,state,paused,allocatedWei,paidWei,remainingWei,returnedWei,claimDeadline,groups')
      || !Number.isInteger(p.slot) || p.slot < 0 || p.slot > 5 || slots.has(p.slot) || !name(p.name)
      || !Number.isInteger(p.state) || p.state < 1 || p.state > 5 || typeof p.paused !== 'boolean'
      || ![p.amountWei,p.allocatedWei,p.paidWei,p.remainingWei,p.returnedWei,p.claimDeadline].every(uint)
      || BigInt(p.amountWei) === 0n || BigInt(p.paidWei) > BigInt(p.allocatedWei) || BigInt(p.allocatedWei) > BigInt(p.amountWei)
      || BigInt(p.paidWei)+BigInt(p.remainingWei)+BigInt(p.returnedWei) !== BigInt(p.amountWei)
      || !Array.isArray(p.groups) || !p.groups.length
      || p.groups.some(g => !exact(g,'name,amountWei') || !name(g.name) || !uint(g.amountWei))
      || p.groups.reduce((n,g)=>n+BigInt(g.amountWei),0n) !== BigInt(p.amountWei)) return fail();
    slots.add(p.slot);
  }
  if (c.pots.reduce((n,p)=>n+BigInt(p.amountWei),0n) !== BigInt(c.budgetWei)) return fail();
  return c;
}

export type PublicRewardBreakdown = {category: string; amountWei: string; place: number | null};
export type PublicRewardDisplay = {name: string; club: string | null; timeMs: string | null};
export function decodePublicRewardDisplay(value: unknown): PublicRewardDisplay {
  const d = value as PublicRewardDisplay;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 300;
  if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).sort().join() !== 'club,name,timeMs'
    || !text(d.name) || d.club !== null && !text(d.club)
    || d.timeMs !== null && (typeof d.timeMs !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(d.timeMs))) throw Error('invalid_public_awards');
  return d;
}

/** Copied sporting display only. No account IDs, recipient addresses or consent. */
export type PublicRewardPage = {
  campaignId: string; slot: number; chainId: 10143 | 31337; blockNumber: string; blockTimestamp: string;
  total: number; offset: number; sort: 'reward' | 'amount'; direction: 'asc' | 'desc';
  availability: 'awaiting_approval' | 'awaiting_distribution' | 'open' | 'paused' | 'closed';
  rows: {id: string; number: number; kind: 'athlete' | 'club'; amountWei: string; status: 'planned' | 'unclaimed' | 'claimed'; breakdown?: PublicRewardBreakdown[]; display?: PublicRewardDisplay}[];
};
export const PUBLIC_REWARD_PAGE_SIZE = 25;
export function decodePublicRewardPage(value: unknown): PublicRewardPage {
  const fail = (): never => {throw Error('invalid_public_awards');};
  const exact = (v: unknown, keys: string) => Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.split(',').sort().join());
  const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v);
  if (!exact(value,'campaignId,slot,chainId,blockNumber,blockTimestamp,total,offset,sort,direction,availability,rows')) return fail();
  const p=value as PublicRewardPage;
  if (!setupId(p.campaignId) || ![10143,31337].includes(p.chainId) || !Number.isInteger(p.slot) || p.slot<0 || p.slot>5
    || !uint(p.blockNumber) || !uint(p.blockTimestamp) || !Number.isInteger(p.total) || p.total<0 || p.total>10000
    || !Number.isInteger(p.offset) || p.offset<0 || p.offset>10000 || p.offset%PUBLIC_REWARD_PAGE_SIZE!==0
    || !['reward','amount'].includes(p.sort) || !['asc','desc'].includes(p.direction)
    || !['awaiting_approval','awaiting_distribution','open','paused','closed'].includes(p.availability)
    || !Array.isArray(p.rows) || p.rows.length!==Math.min(PUBLIC_REWARD_PAGE_SIZE,Math.max(0,p.total-p.offset))) return fail();
  const ids=new Set<string>(),numbers=new Set<number>();
  for (const r of p.rows) {
    if (!exact(r,'id,number,kind,amountWei,status'+(r.breakdown===undefined?'':',breakdown')+(r.display===undefined?'':',display')) || !sponsorTxHash(r.id) || BigInt(r.id)===0n || ids.has(r.id)
      || !Number.isInteger(r.number) || r.number<1 || r.number>p.total || numbers.has(r.number)
      || !['athlete','club'].includes(r.kind) || !uint(r.amountWei) || BigInt(r.amountWei)===0n
      || !['planned','unclaimed','claimed'].includes(r.status)) return fail();
    if (r.breakdown !== undefined && (!Array.isArray(r.breakdown) || !r.breakdown.length || r.breakdown.length > 300
      || r.breakdown.some(b => !exact(b,'category,amountWei,place') || typeof b.category !== 'string' || !b.category.trim() || b.category.length > 300
        || !uint(b.amountWei) || BigInt(b.amountWei) === 0n || b.place !== null && (!Number.isSafeInteger(b.place) || b.place < 1))
      || new Set(r.breakdown.map(b=>b.category)).size !== r.breakdown.length
      || r.breakdown.reduce((sum,b)=>sum+BigInt(b.amountWei),0n)!==BigInt(r.amountWei))) return fail();
    if (r.display !== undefined) {
      decodePublicRewardDisplay(r.display);
      if (r.kind === 'club' && (r.display.club !== null || r.display.timeMs !== null)) return fail();
    }
    ids.add(r.id);numbers.add(r.number);
  }
  return p;
}
