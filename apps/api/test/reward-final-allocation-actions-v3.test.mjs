import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchFinalAllocationActionsV3 } from '../dist/routes/rewards/final-allocation-actions-v3.js';
import { finalAllocationApprovalRequestV3, finalAllocationUploadRequestV3 } from '../dist/features/rewards/final-allocation-actions-v3-service.js';
import { readFinalAllocationApprovalV3, readFinalAllocationUploadV3 } from '../../../packages/db/dist/rewards/index.js';
const id=n=>`8e100000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash='a'.repeat(64);
const expected={requestId:id(3),expectedApprovalId:null,contextHash:hash,documentHash:hash};
test('final prize approval and upload accept exact expectations, not sources, amounts, destinations or clocks',()=>{
  assert.deepEqual(finalAllocationApprovalRequestV3.parse(expected),expected);
  const upload={requestId:id(3),contextHash:hash,documentHash:hash};assert.deepEqual(finalAllocationUploadRequestV3.parse(upload),upload);
  for(const extra of [{document:{}},{funding:{}},{amountWei:'1'},{recipient:id(5)},{reviewSeconds:0},{officialPublishedAt:'2026-01-01'},
    {package:{}},{chainId:143},{source:{}},{requestId:'00000000-0000-0000-0000-000000000000'},{documentHash:'ff'}]){
    assert.throws(()=>finalAllocationApprovalRequestV3.parse({...expected,...extra}));
    assert.throws(()=>finalAllocationUploadRequestV3.parse({...upload,...extra}));
  }
});
test('both final allocation action routes retain Auth, origin, method, query and private error boundaries',async()=>{
  const run=async({action='approval',method='GET',slot=5,query='',authError,rpcError='private-secret-sentinel',body=expected}={})=>{
    const res={},calls=[];
    const handled=await dispatchFinalAllocationActionsV3({method},res,new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/final-allocation-${action}/${slot}${action==='upload'?'/'+id(2):''}${query}`),{
      config:()=>({chainId:31337}),requireIdentity:async()=>{if(authError)throw Error(authError);return{userId:id(10),sessionId:id(11)};},
      readJsonBody:async()=>body,rpc:async(name,args)=>{calls.push({name,args});return{data:null,error:{message:rpcError}};},
      applyPrivateSessionHeaders:()=>res.private=true,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
    });return{res,calls,handled};
  };
  for(const action of ['approval','upload'])for(const slot of [5,6]){
    for(const authError of ['Unauthorized','Missing bearer token','reward_account_session_required']){const r=await run({action,slot,authError});assert.equal(r.res.status,401);assert.equal(r.calls.length,0);}
    assert.equal((await run({action,slot,authError:'Untrusted browser origin'})).res.status,403);
    for(const method of ['PATCH','PUT','DELETE'])assert.equal((await run({action,slot,method})).handled,false);
    for(const query of ['?chainId=143','?amount=1']){const r=await run({action,slot,query});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);}
    const bad=await run({action,slot,method:'POST',body:{...expected,package:{}}});assert.equal(bad.res.status,400);assert.equal(bad.calls.length,0);
    const r=await run({action,slot});assert.equal(r.res.status,503);assert.equal(r.res.private,true);assert.doesNotMatch(JSON.stringify(r.res),/private-secret/);
    for(const rpcError of ['reward_planning_revision_changed','reward_allocation_approval_conflict','reward_allocation_upload_conflict','reward_allocation_not_ready'])
      assert.equal((await run({action,slot,rpcError})).res.status,409);
  }
  for(const slot of [0,1,4,7])assert.equal((await run({slot})).handled,false);
});
test('versioned private repositories reject historical/mainnet scopes before RPC and do not leak provider errors',async()=>{
  const identity={userId:id(1),sessionId:id(2)};
  for(const fn of [readFinalAllocationApprovalV3,readFinalAllocationUploadV3]){
    for(const patch of [{chainId:143},{slot:4},{slot:1},{slot:5.5},{slot:7}]){
      let called=false;await assert.rejects(fn(identity,{chainId:31337,draftId:id(3),slot:5,approvalId:id(4),...patch},async()=>{called=true;throw Error('never');}));
      assert.equal(called,false);
    }
    await assert.rejects(fn(identity,{chainId:31337,draftId:id(3),slot:5,approvalId:id(4)},async()=>{throw Error('private key sentinel');}),{code:'reward_ledger_unavailable'});
  }
});
