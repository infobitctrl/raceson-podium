import {z} from 'zod';
import {reviewBranding,reviewSelection} from './hostedReviewSources';
import {apiRequest} from '@/lib/api';
const wei=z.string().regex(/^(0|[1-9][0-9]{0,24})$/),slot=z.number().int().min(0).max(5);
const pool=z.object({slot,name:z.string().min(1),budgetWei:wei});
const group=z.object({nodeId:z.string(),name:z.string(),slot,type:z.string(),beneficiaryKind:z.enum(['athlete','club']),budgetWei:wei,proposedWei:wei,heldWei:wei,unusedWei:wei,unallocatedWei:wei,hold:z.string().nullable(),
 results:z.array(z.object({key:z.string(),beneficiaryId:z.string(),name:z.string(),club:z.string().nullable(),rankOverall:z.number().int().positive().nullable(),rankCategory:z.number().int().positive().nullable(),finishTimeMs:z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),status:z.enum(['finished','dns','dnf','dsq','standing']),points:z.number().int().nonnegative().nullable()})).max(10000).optional(),
 classification:z.object({trackId:z.string(),trackName:z.string(),categoryName:z.string()}).nullable().optional(),awards:z.array(z.object({beneficiaryId:z.string(),name:z.string(),place:z.number().int().positive().nullable(),value:z.string(),amountWei:wei}))});
const schema=z.object({branding:reviewBranding.optional(),selection:reviewSelection.optional(),version:z.literal('podium-copy-allocation-v1'),setupId:z.string().uuid(),revision:z.number().int().positive(),budgetWei:wei,proposedWei:wei,heldWei:wei,unusedWei:wei,unallocatedWei:wei,
 pools:z.array(pool).min(1).max(6),groups:z.array(group),funding:z.object({state:z.enum(['awaiting_contract','awaiting_funding','funded','cancelled','unverified']),fundedWei:wei.nullable(),remainingWei:wei.nullable(),paidWei:wei.nullable(),returnedWei:wei.nullable(),blockNumber:wei.nullable(),programmeAddress:z.string().regex(/^0x[0-9a-f]{40}$/).nullable(),
 pools:z.array(z.object({slot,budgetWei:wei,remainingWei:wei,paidWei:wei,returnedWei:wei}))})});
export type HostedReviewWorkspaceData=z.infer<typeof schema>;
export type HostedReviewGroup=z.infer<typeof group>;
export async function readHostedReviewWorkspace(id:string,revision:number){
 const data=schema.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${id}`,cache:'no-store'}));
 if(data.branding&&data.branding.id!==id||data.setupId!==id||data.revision!==revision||new Set(data.pools.map(p=>p.slot)).size!==data.pools.length
  ||data.pools.some(p=>BigInt(p.budgetWei)<=0n)||data.pools.reduce((sum,p)=>sum+BigInt(p.budgetWei),0n)!==BigInt(data.budgetWei)
  ||new Set(data.groups.map(g=>g.nodeId)).size!==data.groups.length||data.groups.reduce((sum,g)=>sum+BigInt(g.proposedWei),0n)!==BigInt(data.proposedWei)
  ||BigInt(data.budgetWei)!==BigInt(data.proposedWei)+BigInt(data.heldWei)+BigInt(data.unusedWei)+BigInt(data.unallocatedWei))throw Error('invalid_review');
 for(const g of data.groups)if(new Set(g.results?.map(r=>r.key)).size!==(g.results?.length??0)||!data.pools.some(p=>p.slot===g.slot)||BigInt(g.budgetWei)<=0n
  ||BigInt(g.budgetWei)!==BigInt(g.proposedWei)+BigInt(g.heldWei)+BigInt(g.unusedWei)+BigInt(g.unallocatedWei)
  ||new Set(g.awards.map(a=>a.beneficiaryId)).size!==g.awards.length||g.awards.reduce((sum,a)=>sum+BigInt(a.amountWei),0n)!==BigInt(g.proposedWei))throw Error('invalid_review');
 for(const p of data.pools)if(data.groups.filter(g=>g.slot===p.slot).reduce((sum,g)=>sum+BigInt(g.budgetWei),0n)>BigInt(p.budgetWei))throw Error('invalid_review');
 if(data.funding.state==='funded'&&data.funding.fundedWei!==data.budgetWei)throw Error('invalid_review');
 if(data.funding.pools.some(p=>!data.pools.some(saved=>saved.slot===p.slot&&saved.budgetWei===p.budgetWei)))throw Error('invalid_review');
 return data;
}
/** Combine by sporting identity and kind, never by display name or wallet. */
export function hostedRecipientTotals(groups:HostedReviewGroup[]){
 const totals=new Map<string,{id:string;name:string;kind:'athlete'|'club';categories:number;amountWei:bigint}>();
 for(const g of groups)for(const a of g.awards){
  const id=`${g.beneficiaryKind}:${a.beneficiaryId}`,row=totals.get(id)??{id,name:a.name,kind:g.beneficiaryKind,categories:0,amountWei:0n};
  row.categories++;row.amountWei+=BigInt(a.amountWei);totals.set(id,row);
 }
 return [...totals.values()].sort((a,b)=>a.amountWei===b.amountWei?a.id.localeCompare(b.id):a.amountWei>b.amountWei?-1:1);
}
