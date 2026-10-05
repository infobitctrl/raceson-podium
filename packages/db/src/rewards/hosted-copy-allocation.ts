import { createHash } from 'node:crypto';
import {decodeSavedRewardSetup,type SavedRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import type { FiveRoundCombinedSelection } from '@raceson/domain/rewards/five-round-copy-v1';
import { quoteFiveRoundCopySetupV1, type FiveRoundUnaffiliatedReview } from '@raceson/domain/rewards/five-round-copy-setup-v1';
import { hostedCopySponsor } from './hosted-copy-sponsor.js';
import { readFiveRoundCopyV1,fiveRoundCopyProjectionHashV1, type FiveRoundCopyPinV1 } from './five-round-copy-v1.js';
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
 const current=await hostedCopySponsor(identity,'read',id,undefined,pin,rpc);
 let saved=current.result as SavedRewardSetup,source=current.source;
 // A funded contract retains its launch rules when its editable draft advances.
 // Only the owner-scoped immutable launch reader can supply an older revision.
 if(saved.revision>revision){
  const response=await rpc('service_reward_demo_copy_frozen_setup',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id,p_revision:revision});
  if(response.error){const code=(response.error as {message?:string}).message;throw Error(code&&['reward_account_session_required','reward_demo_sponsor_required','reward_setup_not_found','reward_setup_conflict'].includes(code)?code:'hosted_copy_unavailable');}
  const value=response.data as {result?:unknown;source?:unknown}|null;
  if(!value)throw Error('hosted_copy_unavailable');
  saved=decodeSavedRewardSetup(value.result,10143,id);
  source=await readFiveRoundCopyV1(pin,async()=>value.source);
 }
 if (saved.revision!==revision) throw Error('reward_setup_conflict');
 return composeHostedCopyAllocation(saved,source,pin,selections,unaffiliatedReview);
}
/** Pure calculation shared by owner previews and authorized results-team reads. */
export function composeHostedCopyAllocation(saved:SavedRewardSetup,source:Awaited<ReturnType<typeof readFiveRoundCopyV1>>,pin:FiveRoundCopyPinV1,
 selections:readonly FiveRoundCombinedSelection[]=[],unaffiliatedReview?:FiveRoundUnaffiliatedReview){
 const id=saved.id;
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
