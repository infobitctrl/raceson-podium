import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFinalPublicationViewV3 as publication } from '../../../packages/domain/dist/rewards/final-publication-view-v3.js';
import { decodeFinalProgrammeActionsV3 as decode, nextFinalProgrammeActionV3 as next } from '../../../packages/domain/dist/rewards/final-programme-actions-v3.js';
import { programmeActionsV3 } from '../dist/features/rewards/programme-actions-v3-service.js';
import { dispatchProgrammeActionsV3 } from '../dist/routes/rewards/programme-actions-v3.js';
const id = n => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = slot => ({ chainId: 31337, draftId: id(1), slot, approvalId: id(2), uploadId: id(3), packageHash: 'a'.repeat(64) });
const execution = slot => ({ schema: 'raceson-programme-execution-status-v3', ...scope(slot), documentHash: 'b'.repeat(64),
  current: true, campaignAddress: '0x' + '1'.repeat(40), entitlementCount: '1', steps: [] });
const pub = slot => ({ schema: 'raceson-final-publication-view-v3', ...scope(slot), contextHash: 'c'.repeat(64), evidenceHash: 'd'.repeat(64),
  current: true, reasons: [], timing: { clockKind: slot === 5 ? 'native_round_review' : 'final_round_review', reviewPeriod: '1', finalRoundReviewPeriod: '1',
    reviewStartedAt: '1', officialPublishedAt: '2', nativeRaceCount: 1 }, historicalAcknowledgement: false, publicationBound: true,
  stageReady: false, payableWei: '0', publication: { id: id(4), contextHash: 'c'.repeat(64), evidenceHash: 'd'.repeat(64), recordedAt: '2026-09-11T00:00:00.000Z',
    binding: { reviewId: id(4), publicationId: id(4), reviewPeriod: '1', reviewStartedAt: '1', officialPublishedAt: '2', publicationEvidenceHash: '0x' + 'd'.repeat(64) } } });
const step = (n, action) => ({ intentId: id(10+n), step: n, action, batchStart: action === 'upload_awards' ? 0 : null,
  batchSize: action === 'upload_awards' ? 1 : null, state: 'confirmed', transactionHash: '0x' + String(n+1).repeat(64),
  receipt: { blockNumber: String(100+n), blockHash: '0x' + String(n+1).repeat(64), blockTimestamp: '100', feeWei: '1', recordedAt: '2026-09-11T00:00:00.000Z' } });
test('final action state requires exact current final publication and ordered receipts, without reinterpreting historical sources', () => {
  for (const slot of [5,6]) {
    const e=execution(slot), p=publication(pub(slot),scope(slot));
    assert.equal(next(e,null).action,'complete_funding');
    e.steps.push(step(0,'complete_funding'));assert.equal(next(e,null).action,'upload_awards');
    e.steps.push(step(1,'upload_awards'));assert.equal(next(e,null),null);assert.equal(next(e,p).action,'stage_allocation');
    assert.equal(next(e,{...p,slot:slot===5?6:5}),null);assert.equal(next(e,{...p,publicationBound:false}),null);
    e.steps.push(step(2,'stage_allocation'));assert.equal(next(e,p).action,'activate');
    assert.equal(next({...e,current:false},p),null);
    e.steps.push(step(3,'activate'));assert.equal(next(e,p),null);
  }
  assert.throws(()=>next(execution(1),pub(5)));
});
test('final publication projection rejects forged readiness, mismatched clocks, private fields and executable values', () => {
  for (const mutate of [p=>p.schema='raceson-round-publication-view-v3',p=>p.slot=4,p=>p.packageHash='e'.repeat(64),p=>p.stageReady=true,
    p=>p.payableWei='1',p=>p.current=false,p=>p.publicationBound=false,p=>p.timing.reviewPeriod='0',p=>p.timing.nativeRaceCount=0,
    p=>p.publication.binding.reviewStartedAt='2',p=>p.publication.binding.publicationId=id(6),p=>p.publication.evidenceHash='e'.repeat(64),
    p=>p.nativeRaces=[],p=>p.publication.privateKey='never']) {
    const p=pub(5);mutate(p);assert.throws(()=>publication(p,scope(5)));
  }
  const p=pub(6);p.current=false;p.timing=null;p.evidenceHash=null;p.publicationBound=false;p.reasons=['reward_final_publication_not_ready'];
  assert.equal(publication(p,scope(6)).publication.id,id(4),'held history stays readable without a new action');
  let ran=false;Object.defineProperty(p.reasons,'0',{enumerable:true,get(){ran=true;return ''}});assert.throws(()=>publication(p,scope(6)));assert.equal(ran,false);
});
test('final actions have a strict separate schema with shared immutable selection semantics', () => {
  for(const slot of [5,6]){
    const v={schema:'raceson-final-programme-actions-v3',execution:execution(slot),publication:null,selected:null,ack:null};
    assert.deepEqual(decode(v),v);assert.throws(()=>decode({...v,schema:'raceson-programme-actions-v3'}));
    assert.throws(()=>decode({...v,privateKey:'never'}));assert.throws(()=>decode({...v,publication:pub(slot===5?6:5)}));
  }
});
test('final action GET/POST routing preserves historical boundaries, private Auth, origin and caller-payload guards', async () => {
  const identity={userId:id(90),sessionId:id(91)};
  const run=async({slot=5,method='GET',suffix='final-allocation-actions',query='',body,authError,rpcError}={})=>{
    const res={},calls=[];
    const handled=await dispatchProgrammeActionsV3({method},res,new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/${suffix}/${slot}/${id(2)}/${id(3)}${query}`),{
      config:()=>({chainId:31337}),requireIdentity:async()=>{if(authError)throw Error(authError);return identity;},readJsonBody:async()=>body,
      applyPrivateSessionHeaders:()=>res.private=true,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
      rpc:async(name,args)=>{calls.push({name,args});return{data:execution(slot),error:rpcError?{message:rpcError}:null};}
    });return{res,calls,handled};
  };
  for(const slot of [5,6]){
    const good=await run({slot});assert.equal(good.res.status,200);assert.equal(good.res.private,true);assert.equal(good.res.data.schema,'raceson-final-programme-actions-v3');
    assert.equal((await run({slot,authError:'Unauthorized'})).res.status,401);assert.equal((await run({slot,authError:'Untrusted browser origin'})).res.status,403);
    assert.equal((await run({slot,query:'?chainId=143'})).res.status,400);
    for(const body of [{action:'activate'},{kind:'sign',privateKey:'never'},{kind:'prepare',reviewStartedAt:'1'}]){
      const r=await run({slot,method:'POST',body});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);
    }
    assert.equal((await run({slot,suffix:'allocation-actions'})).handled,false);
    await assert.rejects(programmeActionsV3(identity,scope(slot),undefined,{rpc:()=>assert.fail('historical API remains narrow')}));
  }
  assert.equal((await run({slot:1})).handled,false);assert.equal((await run({method:'DELETE'})).handled,false);
  const failed=await run({rpcError:'secret-bearing upstream error'});assert.equal(failed.res.status,503);assert.doesNotMatch(JSON.stringify(failed.res),/secret-bearing/);
});
