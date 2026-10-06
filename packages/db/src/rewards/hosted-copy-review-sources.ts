import {setupId,previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {decodeSponsorLaunchView} from '@raceson/domain/rewards/sponsor-launch';
import {decodeSponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import {readFiveRoundCopyV1,type FiveRoundCopyPinV1} from './five-round-copy-v1.js';
import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
export async function hostedCopyReviewSources(identity:RewardAccountIdentity,id:string|null,pin:FiveRoundCopyPinV1,rpc:RewardLedgerRpc){
 if(![identity.userId,identity.sessionId].every(setupId)||id!==null&&!setupId(id))throw Error('invalid_reward_setup');
 const response=await rpc('service_reward_demo_copy_review_sources',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id});
 if(response.error){const code=(response.error as {message?:string}).message;throw Error(code&&['reward_account_session_required','reward_demo_account_required','reward_demo_reviewer_required'].includes(code)?code:'hosted_copy_unavailable');}
 const raw=response.data as {version?:unknown;items?:unknown[]}|null;
 if(!raw||raw.version!=='podium-copy-review-sources-v1'||!Array.isArray(raw.items)||raw.items.length>200||Object.keys(raw).sort().join()!=='items,version')throw Error('hosted_copy_unavailable');
 const items=await Promise.all(raw.items.map(async value=>{
  const r=value as {id:string;launch:{setup:unknown};execution:unknown;source:unknown};
  if(!r||Object.keys(r).sort().join()!=='execution,id,launch,source'||!setupId(r.id)||id!==null&&r.id!==id)throw Error('hosted_copy_unavailable');
  const launch=decodeSponsorLaunchView({setup:r.launch.setup,launch:r.launch},10143,r.id).launch;
  if(!launch)throw Error('hosted_copy_unavailable');
  const execution=decodeSponsorExecutionRecord(r.execution);
  if(execution&&(execution.plan.chainId!==10143||execution.plan.launchId!==launch.id||execution.plan.setupRevision!==launch.setup.revision||execution.plan.configurationHash!==launch.configurationHash))throw Error('hosted_copy_unavailable');
  const source=id===null?null:await readFiveRoundCopyV1(pin,async()=>r.source);
  if(id===null&&r.source!==null)throw Error('hosted_copy_unavailable');
  const budget=previewRewardSetup(launch.setup.configuration);
  const configuration=launch.setup.configuration;
  const pools=(configuration.guided?.pots??[]).flatMap(p=>{
   const amount=budget.rows.find(row=>row.id===p.nodeId)?.amountWei;
   if(amount===null||amount===undefined||amount<=0n)return [];
   const node=configuration.root.children.find(n=>n.id===p.nodeId)!;
   const name=configuration.sponsorSelection?.eventEditionId&&configuration.context?.eventName?configuration.context.eventName:node.name;
   return [{slot:p.slot,name,budgetWei:amount.toString()}];
  });
  return {launch,source,execution,summary:{id:r.id,name:configuration.name,revision:launch.setup.revision,launchId:launch.id,pools,
   budgetWei:budget.budgetWei.toString(),executionState:!execution?.deploymentHash?'awaiting_contract' as const:!execution.fundingHash?'awaiting_funding' as const:'needs_chain_check' as const}};
 }));
 if(new Set(items.map(i=>i.summary.id)).size!==items.length)throw Error('hosted_copy_unavailable');
 if(id!==null&&items.length!==1)throw Error('reward_setup_not_found');
 return items;
}
