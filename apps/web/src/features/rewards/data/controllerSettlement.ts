import {z} from 'zod';
const wei=z.string().regex(/^(0|[1-9][0-9]*)$/),hash=z.string().regex(/^0x[0-9a-f]{64}$/),address=z.string().regex(/^0x[0-9a-f]{40}$/),action=z.enum(['close','returnUnallocated','returnExpired']);
const lane=z.object({recipient:address,originalWei:wei,returnedWei:wei,remainingWei:wei}).strict();
const schema=z.object({schema:z.literal('podium-sponsor-settlement-view-v1'),setupId:z.string().uuid(),slot:z.number().int().min(0).max(5),sourceHash:z.string().regex(/^[0-9a-f]{64}$/),operator:address,
 pot:z.object({slot:z.number().int().min(0).max(5),address,amountWei:wei,state:z.number().int().min(1).max(4),paused:z.boolean(),allocatedWei:wei,paidWei:wei,returnedWei:wei,remainingWei:wei,claimDeadline:wei,entitlementCount:wei}).strict().nullable(),
 lanes:z.object({unallocated:lane,expired:lane}).strict().nullable(),available:z.array(z.object({action,recipient:address.nullable(),amountWei:wei}).strict()).max(2),
 observedBlock:z.object({number:wei,hash,timestamp:wei}).strict().nullable(),receipts:z.array(z.object({id:z.string().uuid(),body:z.object({schema:z.literal('podium-sponsor-settlement-receipt-v1'),action,slot:z.number().int().min(0).max(5),campaignAddress:address,recipient:address.nullable(),amountWei:wei,transactionHash:hash,blockNumber:wei,blockHash:hash,blockTimestamp:wei}).strict()}).strict()).max(3)}).strict();
export type ControllerSettlement=z.infer<typeof schema>;
export function decodeControllerSettlement(value:unknown,setupId:string,slot:number,wallet:string){
 const v=schema.parse(value);if(v.setupId!==setupId||v.slot!==slot||v.operator!==wallet)throw Error('invalid_settlement');
 if(v.pot===null){if(v.lanes!==null||v.observedBlock!==null||v.available.length||v.receipts.length)throw Error('invalid_settlement');return v;}
 const p=v.pot,l=v.lanes;if(!l||!v.observedBlock||p.slot!==slot||BigInt(p.amountWei)!==BigInt(p.paidWei)+BigInt(p.returnedWei)+BigInt(p.remainingWei)
  ||BigInt(p.paidWei)>BigInt(p.allocatedWei)||BigInt(p.allocatedWei)>BigInt(p.amountWei)
  ||BigInt(l.unallocated.originalWei)!==BigInt(p.amountWei)-BigInt(p.allocatedWei)||BigInt(l.expired.originalWei)!==BigInt(p.allocatedWei)-BigInt(p.paidWei)
  ||BigInt(p.returnedWei)!==BigInt(l.unallocated.returnedWei)+BigInt(l.expired.returnedWei))throw Error('invalid_settlement');
 for(const lane of Object.values(l))if(BigInt(lane.originalWei)!==BigInt(lane.returnedWei)+BigInt(lane.remainingWei)||(lane.returnedWei!=='0'&&lane.returnedWei!==lane.originalWei))throw Error('invalid_settlement');
 const expected:ControllerSettlement['available']=[];
 if(p.state===3&&!p.paused&&BigInt(p.claimDeadline)>0n&&BigInt(v.observedBlock.timestamp)>=BigInt(p.claimDeadline))expected.push({action:'close',recipient:null,amountWei:'0'});
 if(p.state===4){for(const [key,a] of [['unallocated','returnUnallocated'],['expired','returnExpired']] as const)if(BigInt(l[key].remainingWei)>0n)expected.push({action:a,recipient:l[key].recipient,amountWei:l[key].remainingWei});}
 if(JSON.stringify(expected)!==JSON.stringify(v.available)||p.state!==4&&p.returnedWei!=='0'||new Set(v.receipts.map(r=>r.body.action)).size!==v.receipts.length)throw Error('invalid_settlement');
 for(const r of v.receipts){const b=r.body,lr=b.action==='returnUnallocated'?l.unallocated:l.expired;
  if(p.state!==4||b.slot!==slot||b.campaignAddress!==p.address||(b.action==='close'?(b.recipient!==null||b.amountWei!=='0'):(b.recipient!==lr.recipient||b.amountWei!==lr.originalWei||lr.remainingWei!=='0')))throw Error('invalid_settlement');}
 return v;
}
