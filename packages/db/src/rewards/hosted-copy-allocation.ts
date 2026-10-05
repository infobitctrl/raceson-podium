import { createHash } from 'node:crypto';
import type { SavedRewardSetup } from '@raceson/domain/rewards/distribution-setup';
import type { FiveRoundCombinedSelection } from '@raceson/domain/rewards/five-round-copy-v1';
import { quoteFiveRoundCopySetupV1, type FiveRoundUnaffiliatedReview } from '@raceson/domain/rewards/five-round-copy-setup-v1';
import { hostedCopySponsor } from './hosted-copy-sponsor.js';
import { fiveRoundCopyProjectionHashV1, type FiveRoundCopyPinV1 } from './five-round-copy-v1.js';
import type { RewardAccountIdentity } from './athlete-wallets.js';
import type { RewardLedgerRpc } from './programme-ledger.js';
/** Compatibility with the canonical SQL template's deterministic node IDs.
 * MD5 here is an identifier format, never an integrity or authorization hash. */
export function hostedCopySetupNodeId(id:string,key:string) {
 const h=createHash('md5').update(`${id}:${key}`).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
async function readSnapshot(identity:RewardAccountIdentity,id:string,revision:number,pin:FiveRoundCopyPinV1,
 rpc:RewardLedgerRpc,selections:readonly FiveRoundCombinedSelection[]=[],unaffiliatedReview?:FiveRoundUnaffiliatedReview) {
 if (!Number.isInteger(revision)||revision<1||revision>2147483645) throw Error('invalid_reward_setup');
 const {result,source}=await hostedCopySponsor(identity,'read',id,undefined,pin,rpc),saved=result as SavedRewardSetup;
 if (saved.revision!==revision) throw Error('reward_setup_conflict');
 const bindings=Array.from({length:6},(_,slot)=>source.classifications.map(c=>({nodeId:hostedCopySetupNodeId(id,`group:${slot}:${c.id}`),classificationId:c.id}))).flat();
 const c=saved.configuration;
 if (c.root.id!==hostedCopySetupNodeId(id,'root')) throw Error('invalid_copy_setup_binding');
 for (const pot of c.guided?.pots??[]) {
  if(pot.nodeId!==hostedCopySetupNodeId(id,`pot:${pot.slot}`))throw Error('invalid_copy_setup_binding');
  const nodes=c.root.children.find(n=>n.id===pot.nodeId)?.children??[];
  for (const n of nodes) {
   const group=c.guided!.groups.find(g=>g.nodeId===n.id)!;
   if(group.type==='athlete_standings' ? !source.classifications.some(category=>n.id===hostedCopySetupNodeId(id,`group:${pot.slot}:${category.id}`)) : n.id!==hostedCopySetupNodeId(id,`group:${pot.slot}:${group.type}`))throw Error('invalid_copy_setup_binding');
  }
 }
 const quote=quoteFiveRoundCopySetupV1(saved,source,bindings,pin.projectionSha256,selections,unaffiliatedReview);
 return {allocation:{...quote,configurationHash:fiveRoundCopyProjectionHashV1(c)},configuration:c,sportingSha256:source.sportingSha256};
}
export async function readHostedCopyAllocation(...args:Parameters<typeof readSnapshot>) {
 return (await readSnapshot(...args)).allocation;
}

export type HostedCopyReviewVersions = {combined:string;unaffiliated:string|null};
/** Portable review evidence only. No signed payload, wallet, controller approval
 * or chain command is constructed. The read RPC checks the live owner session.
 * A saved revision and both exact decision sets belong to one immutable digest. */
export async function readHostedCopyAllocationHandoff(identity:RewardAccountIdentity,id:string,revision:number,pin:FiveRoundCopyPinV1,
 rpc:RewardLedgerRpc,selections:readonly FiveRoundCombinedSelection[],unaffiliatedReview:FiveRoundUnaffiliatedReview|undefined,versions:HostedCopyReviewVersions) {
 const snapshot=await readSnapshot(identity,id,revision,pin,rpc,selections,unaffiliatedReview);
 if(!versions.combined || (!!unaffiliatedReview!==!!versions.unaffiliated))throw Error('invalid_copy_setup_binding');
 // JSON transport represents wei as decimal strings; source IDs are pseudonymous.
 const document=JSON.parse(JSON.stringify({
  version:'podium-copy-review-document-v1',chainId:10143,state:'unapproved',payableWei:'0',
  source:{...pin,sportingSha256:snapshot.sportingSha256},
  setup:{id,revision,configuration:snapshot.configuration},
  reviews:{combined:{version:versions.combined,sourceHash:pin.projectionSha256,selections},
   unaffiliated:unaffiliatedReview?{version:versions.unaffiliated,sourceHash:unaffiliatedReview.sourceHash,resultIds:[...unaffiliatedReview.resultIds].sort()}:null},
  allocation:snapshot.allocation,
 },(_key,v)=>typeof v==='bigint'?v.toString():v));
 return {version:'podium-copy-review-handoff-v1' as const,documentHash:fiveRoundCopyProjectionHashV1(document),document};
}
