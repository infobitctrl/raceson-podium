import { beforeEach, expect, it, vi } from 'vitest';
import { keccak256,toHex } from 'viem';
import { canonicalRewardJson } from '@raceson/rewards-chain';
import { inspectWorkflow,scheduleWorkflow,type ProgrammeWorkflowTarget } from './workflowV3';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/api',()=>({apiRequest:mock.request}));
vi.mock('@/lib/public-env',()=>({publicEnv:{rewardPortalEnabled:true,rewardDemo:{mode:'local'}}}));
const id=(n:number)=>`8fe00000-0000-4000-8000-${String(n).padStart(12,'0')}`, hash=`0x${'a'.repeat(64)}`;
const target:ProgrammeWorkflowTarget={kind:'programme',draftId:id(1),slot:6,approvalId:id(2),uploadId:id(3),intentId:id(4),attemptId:id(5)};
function fixture(){const {kind:_,...scope}=target;const body={schema:'raceson-programme-signing-plan-v3',...scope,chainId:31337,action:'activate',campaignAddress:`0x${'2'.repeat(40)}`,operatorAddress:`0x${'3'.repeat(40)}`,budgetWei:'1000000000000000001',allocatedWei:'900000000000000001',nonce:'7',fees:{maxGasCostWei:'500000000000000000'}};return {schema:'raceson-workflow-inspection-v1',target,plan:{...body,planHash:keccak256(toHex(canonicalRewardJson(body)))},recorded:false,transactionHash:null}}
beforeEach(()=>mock.request.mockReset().mockResolvedValue(fixture()));
it('binds inspection and signing to the exact programme attempt and recomputed plan hash',async()=>{
 const view=await inspectWorkflow(target,31337);expect(view.plan.budgetWei).toBe('1000000000000000001');
 await inspectWorkflow(target,31337,view.plan.planHash);expect(mock.request.mock.calls[1][0]).toMatchObject({path:'/v1/organizer/rewards/workflow-v3/sign',body:{target,planHash:view.plan.planHash}});
});
it('rejects substituted targets, altered amounts and falsely confirmed signatures',async()=>{
 for(const change of [(r:ReturnType<typeof fixture>)=>r.target={...target,slot:5},(r:ReturnType<typeof fixture>)=>r.plan.allocatedWei='1',(r:ReturnType<typeof fixture>)=>r.recorded=true]){const r=fixture();change(r);mock.request.mockResolvedValueOnce(r);await expect(inspectWorkflow(target,31337)).rejects.toThrow()}
});
it('keeps missing runtime errors visible and validates scheduled versus confirmed',async()=>{
 mock.request.mockRejectedValueOnce({status:503,code:'reward_workflow_not_configured'});await expect(inspectWorkflow(target,31337)).rejects.toMatchObject({status:503});
 // Exact Task 1 route projection: the ledger also carries the send fence and
 // a persisted schedule always has progress, including its initial state.
 const result={schema:'raceson-workflow-schedule-status-v1',target,jobId:id(6),transactionHash:hash,state:'submitted',confirmed:false,reconciliationRequired:true,scheduled:true,
  scheduler:{outcome:'scheduled',attempts:0,nextAttemptAt:0,updatedAt:0}};mock.request.mockResolvedValueOnce(result);
 expect(await scheduleWorkflow(target,31337,id(6),hash)).toEqual({state:'submitted',confirmed:false,reconciliationRequired:true,scheduled:true,scheduler:result.scheduler});
 mock.request.mockResolvedValueOnce({...result,confirmed:true});await expect(scheduleWorkflow(target,31337,id(6),hash)).rejects.toThrow();
});
it('validates exact backend progress, preserving ledger confirmation rather than inferring it from worker progress',async()=>{
 const result={schema:'raceson-workflow-schedule-status-v1',target,jobId:id(6),transactionHash:hash,state:'submitted',confirmed:false,reconciliationRequired:true,scheduled:true,
  scheduler:{outcome:'confirmed',attempts:2,nextAttemptAt:0,updatedAt:1770000000000}};
 mock.request.mockResolvedValueOnce(result);
 expect(await scheduleWorkflow(target,31337,id(6),hash,true)).toMatchObject({confirmed:false,reconciliationRequired:true,scheduler:{outcome:'confirmed'}});
 for(const patch of [{reconciliationRequired:undefined},{reconciliationRequired:'true'},{scheduler:null},{scheduled:false},
  {scheduler:{...result.scheduler,attempts:-1}},{scheduler:{...result.scheduler,outcome:'paid'}},
  {scheduler:{...result.scheduler,signedTransaction:'0xsecret'}}]){
   mock.request.mockResolvedValueOnce({...result,...patch});await expect(scheduleWorkflow(target,31337,id(6),hash,true)).rejects.toThrow();
 }
 mock.request.mockResolvedValueOnce({...result,scheduled:false,scheduler:null});
 expect(await scheduleWorkflow(target,31337,id(6),hash,true)).toMatchObject({scheduled:false,scheduler:null});
});
