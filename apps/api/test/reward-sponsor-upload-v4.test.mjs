import test from 'node:test';
import assert from 'node:assert/strict';
import {sponsorAllocationFixture,sponsorFixtureId as id} from './fixtures/sponsor-allocation.mjs';
import {decodeRewardAllocationSourceV3} from '@raceson/domain/rewards/allocation-preview-v3';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {sponsorAllocationDocumentHashV4 as digest,decodeSponsorAllocationDocumentV4,sponsorUploadFactsV4} from '@raceson/db/rewards';
import {composeSponsorUploadV4,sponsorUploadV4} from '../dist/features/rewards/sponsor-upload-v4-service.js';
import {dispatchSponsorAllocationV4} from '../dist/routes/rewards/sponsor-allocation-v4.js';
const h=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture(slot=0){
 const f=sponsorAllocationFixture();f.source=decodeRewardAllocationSourceV3(f.source);const calculation=previewSponsorAllocation(f.launch,f.plan,f.binding,f.source).pots[slot];
 const document={schema:'raceson-sponsor-allocation-document-v4',...f,slot,contextHash:'c'.repeat(64),calculation};
 return{document,documentHash:digest(document),contextHash:document.contextHash,approvalId:id(900),current:true,
  execution:{plan:f.plan,deploymentHash:h(1),fundingHash:h(2)},snapshotSalt:h(100),prepared:null,
  recipients:calculation.recipients.map((r,i)=>({...r,amountWei:r.amountWei,entitlementId:h(200+i),opaqueBeneficiaryId:h(300+i),explanationSalt:h(400+i)}))};
}
test('saved V4 package preserves exact approved amounts, random IDs, treasury rules and privacy for league and race',()=>{
 for(const slot of [0,1]){
  const f=fixture(slot),p=composeSponsorUploadV4(f,'0x'+'55'.repeat(20));
  assert.deepEqual(p,composeSponsorUploadV4(f,'0x'+'55'.repeat(20)));
  assert.equal(p.allocatedWei,f.document.calculation.proposedWei.toString());assert.equal(BigInt(p.allocatedWei)+BigInt(p.unallocatedWei),BigInt(p.budgetWei));
  assert.equal(p.claimLifetime,String(f.document.plan.claimLifetime));assert.equal(p.unallocatedTreasury,f.document.plan.unallocatedTreasury);
  assert.ok(p.awards.every(a=>a.pot===(slot===0?1:0)));assert.ok(!('allocationDigest' in p));assert.ok(!('officialPublishedAt' in p));
  for(const r of f.recipients){assert.ok(!JSON.stringify(p).includes(r.beneficiaryId));assert.ok(!JSON.stringify(p).includes(r.explanationSalt));}
  const scope={chainId:31337,setupId:f.document.launch.setup.id,slot,approvalId:f.approvalId};
  assert.deepEqual(decodeSponsorAllocationDocumentV4(f.document,scope),f.document);
  for(const mutate of [d=>d.calculation.proposedWei++,d=>d.plan.caps[slot]='1',d=>d.source.rounds[0].results[0].athleteId=id(999)]){
   const d=structuredClone(f.document);mutate(d);assert.throws(()=>decodeSponsorAllocationDocumentV4(d,scope));
  }
 }
});
test('saved V4 upload rejects altered, duplicate or missing private bindings and reused salts',()=>{
 for(const mutate of [f=>f.recipients.pop(),f=>f.recipients.push(f.recipients[0]),f=>f.recipients[0].amountWei++,
  f=>f.recipients[0].explanationSalt=f.snapshotSalt,f=>f.recipients[1].entitlementId=f.recipients[0].entitlementId,
  f=>f.recipients[1].opaqueBeneficiaryId=f.recipients[0].opaqueBeneficiaryId,f=>f.execution.fundingHash=null]){
  const f=fixture();mutate(f);assert.throws(()=>composeSponsorUploadV4(f,'0x'+'55'.repeat(20)));
 }
});
test('upload HTTP accepts only preparation commitment, never rows, keys, wallets, clocks or arbitrary addresses',async()=>{
 let calls=0,response,body;
 const deps={config:()=>({chainId:31337}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),rpc:async()=>{calls++;throw Error('not expected');},
  readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const url=new URL(`http://local/api/v1/organizer/rewards/sponsor-setups/${id(3)}/allocations/1/${id(4)}/upload`),res={setHeader(){}};
 const valid={requestId:id(5),contextHash:'a'.repeat(64),documentHash:'b'.repeat(64)};
 for(const extra of [{awards:[]},{privateKey:'synthetic-forbidden'},{wallet:'0xabc'},{programmeAddress:'0xabc'},{reviewStartedAt:1},{publication:{}},{funding:{funded:true}},{chainId:10143},{package:{}}]){
  body={...valid,...extra};await dispatchSponsorAllocationV4({method:'POST'},res,url,deps);assert.equal(response.status,400);
 }
 await dispatchSponsorAllocationV4({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);
 assert.equal(calls,0);
});
test('private upload repository rejects foreign scope and corrupt stored calculations before exposing records',async()=>{
 const f=fixture(),scope={chainId:31337,setupId:f.document.launch.setup.id,slot:0,approvalId:f.approvalId};
 const raw={...f,recipients:f.recipients.map(({groupIds,...r})=>({...r,amountWei:r.amountWei.toString()}))};
 const rpc=async()=>({data:raw,error:null});
 const decoded=await sponsorUploadFactsV4({userId:id(7),sessionId:id(8)},scope,undefined,rpc);assert.equal(decoded.documentHash,f.documentHash);
 const view=await sponsorUploadV4({userId:id(7),sessionId:id(8)},scope,undefined,{rpc});assert.equal(view.executionStatus,'not_observed');assert.equal(view.stageReady,false);assert.equal(view.payableWei,'0');
 raw.document.calculation.proposedWei++;await assert.rejects(()=>sponsorUploadFactsV4({userId:id(7),sessionId:id(8)},scope,undefined,rpc));
});
