import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,saved,setupId,id} from './fixtures/hosted-approval-fixture.mjs';
import {composeHostedCopyAwardDocument,decodeHostedCopyAwardDocument,hostedCopyUploadRpc,hostedCopyLifecycleRpc} from '../../../packages/db/dist/rewards/index.js';
import {fiveRoundCopyProjectionHashV1} from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
import {composeHostedCopyAllocation} from '../../../packages/db/dist/rewards/hosted-copy-allocation.js';
import {createSponsorExecutionPlan} from '../../../packages/domain/dist/rewards/sponsor-execution.js';
import {canonicalRewardProposalV2 as canonical} from '../../../packages/domain/dist/rewards/frozen-proposal-v2.js';
import {sponsorAllocationDocumentHashV4 as digest} from '../../../packages/db/dist/rewards/sponsor-allocation-v4.js';
import {hostedCopyPublicationEvidence} from '../dist/features/rewards/hosted-copy-publication.js';
import {composeSponsorUploadV4} from '../dist/features/rewards/sponsor-upload-v4-service.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {hostedCopyResultDisplay} from '../dist/features/rewards/hosted-copy-result-display.js';
function context(){
 const source=fixture(),record=saved(source),pin={batchSha256:source.batchSha256,projectionSha256:fiveRoundCopyProjectionHashV1(source),leagueId:source.leagueId,seasonId:source.seasonId};
 const policy={pin,selections:[],unaffiliatedReview:undefined,versions:{combined:'synthetic-v1',unaffiliated:'synthetic-v1'}};
 const launch={id:id(9902),state:'prepared',configurationHash:'f'.repeat(64),createdAt:record.updatedAt,setup:record};
 const plan=createSponsorExecutionPlan(launch,'0x'+'1'.repeat(40),{operator:'0x'+'2'.repeat(40),treasury:'0x'+'3'.repeat(40),reviewPeriods:[0,0,0,0,0,0]});
 const facts={launch,execution:{plan,deploymentHash:null,fundingHash:null},sourceFacts:source,contextHash:'e'.repeat(64)};
 return{source,policy,facts,document:composeHostedCopyAwardDocument(facts,0,policy),scope:{chainId:10143,setupId,slot:0}};
}
test('shared reconstruction preserves the released approval document and walletless shares exactly',()=>{
 const x=context(),groups=composeHostedCopyAllocation(x.facts.launch.setup,x.source,x.policy.pin,[],undefined).allocation.groups.filter(g=>g.slot===0);
 // Independent reconstruction of the released 299d868 approval format.
 const r=groups.flatMap(g=>g.awards.map(a=>({beneficiaryId:a.beneficiaryId,beneficiaryKind:g.beneficiaryKind,amountWei:a.amountWei,groupIds:[g.nodeId]})));
 const old={schema:'podium-copy-allocation-document-v1',launch:x.facts.launch,plan:x.facts.execution.plan,binding:{...x.policy.pin,...x.policy.versions},source:x.source,slot:0,contextHash:x.facts.contextHash,
  calculation:{slot:0,budgetWei:101n,proposedWei:101n,retainedWei:0n,groups,recipients:r}};
 assert.equal(canonical(x.document),canonical(old));assert.equal(digest(x.document),digest(old));
 assert.equal(x.document.calculation.recipients[0].amountWei,101n);assert.equal('wallet' in x.document.calculation.recipients[0],false);
 assert.equal(canonical(decodeHostedCopyAwardDocument(JSON.parse(canonical(x.document)),x.scope,x.policy)),canonical(old));
});
test('stored copy reconstruction rejects changed amounts, source, plan, decision binding, scope and holds',()=>{
 for(const edit of [d=>d.calculation.recipients[0].amountWei='102',d=>d.calculation.proposedWei='102',d=>d.binding.combined='other',d=>d.source.results[0].finishTimeMs='1',d=>d.plan.caps[0]='102',d=>d.extra=true,d=>d.slot=1]){
  const x=context(),d=JSON.parse(canonical(x.document));edit(d);assert.throws(()=>decodeHostedCopyAwardDocument(d,x.scope,x.policy));
 }
 const x=context();assert.throws(()=>decodeHostedCopyAwardDocument(x.document,{...x.scope,chainId:31337},x.policy));
 assert.throws(()=>decodeHostedCopyAwardDocument(x.document,{...x.scope,setupId:id(999)},x.policy));
 assert.throws(()=>decodeHostedCopyAwardDocument(x.document,x.scope)); // Synthetic source never passes the deployed pin.
 const empty=composeHostedCopyAwardDocument(x.facts,1,x.policy);assert.throws(()=>decodeHostedCopyAwardDocument(empty,{...x.scope,slot:1},x.policy));
});
test('copy upload uses existing private IDs and exact conservation without exposing sporting identities',()=>{
 const x=context(),h=n=>'0x'+n.toString(16).padStart(64,'0');
 const f={document:x.document,documentHash:digest(x.document),contextHash:x.document.contextHash,approvalId:id(9903),current:true,execution:{...x.facts.execution,deploymentHash:h(1),fundingHash:h(2)},snapshotSalt:h(3),prepared:null,
  recipients:x.document.calculation.recipients.map((r,i)=>({...r,entitlementId:h(10+i),opaqueBeneficiaryId:h(20+i),explanationSalt:h(30+i)}))};
 const p=composeSponsorUploadV4(f,'0x'+'5'.repeat(40));assert.equal(p.allocatedWei,'101');assert.equal(p.unallocatedWei,'0');assert.equal(p.budgetWei,'101');
 assert.equal(p.awards[0].beneficiaryId,h(20));assert.equal(JSON.stringify(p).includes(f.recipients[0].beneficiaryId),false);
 f.execution.fundingHash=null;assert.throws(()=>composeSponsorUploadV4(f,'0x'+'5'.repeat(40)));
});
test('controller copy display uses exact recipient totals without inventing a sporting result or per-result payment',()=>{
 const x=context(),v=hostedCopyResultDisplay(x.document),r=x.document.calculation.recipients[0];
 assert.equal(v.allocatedWei,'101');assert.equal(v.recipientTotals[0].amountWei,'101');assert.equal(v.recipientTotals[0].name,x.source.athletes.find(a=>a.id===r.beneficiaryId).name);
 assert.equal(v.rows[0].rank,null);assert.equal(v.rows[0].timeMs,null);assert.equal(v.rows[0].club,null);assert.equal(v.rows[0].amountWei,'101');
 assert.deepEqual(v.rows[0].categories,r.groupIds.map(id=>x.document.calculation.groups.find(g=>g.nodeId===id).name));
 x.document.calculation.groups[0].hold='changed_source';assert.equal(hostedCopyResultDisplay(x.document).rows[0].amountWei,null);
});
test('publication binds actual official clocks for a pool or all pools and rejects an invented review period',()=>{
 const x=context(),d=x.document;d.source.races[4].publishedAt='2026-10-05T13:01:02.999Z';
 const args=[id(9903),'a'.repeat(64),digest(d)];
 const all=hostedCopyPublicationEvidence(d,...args);assert.equal(all.timing.officialPublishedAt,String(Date.parse('2026-10-05T13:01:02Z')/1000));
 assert.equal(all.timing.reviewStartedAt,all.timing.officialPublishedAt);assert.equal(all.evidence.publications.length,5);assert.equal(all.evidence.binding,d.binding);
 const one=hostedCopyPublicationEvidence({...d,slot:2},...args);assert.equal(one.evidence.publications.length,1);assert.equal(one.evidence.publications[0].slot,2);
 assert.equal(one.timing.officialPublishedAt,String(Date.parse(x.source.races[1].publishedAt)/1000));
 assert.throws(()=>hostedCopyPublicationEvidence({...d,plan:{...d.plan,reviewPeriods:[1,0,0,0,0,0]}},...args),/historical_review_unavailable/);
 d.source.races[0].publishedAt='invalid';assert.throws(()=>hostedCopyPublicationEvidence(d,...args),/source_not_ready/);
});
test('fixed upload/lifecycle transports never widen identity, chain, method or request authority',async()=>{
 const actor={userId:id(1),sessionId:id(2)},calls=[],rpc=hostedCopyLifecycleRpc(actor,async(n,a)=>{calls.push([n,a]);return{data:null,error:null};});
 const scope={p_actor_user_id:actor.userId,p_actor_session_id:actor.sessionId,p_chain_id:10143,p_setup_id:setupId,p_slot:0,p_approval_id:id(3)};
 await rpc('service_read_reward_sponsor_upload_v4',scope);assert.equal(calls[0][0],'service_reward_demo_copy_upload');assert.equal(calls[0][1].p_operation,'read');assert.equal('p_chain_id' in calls[0][1],false);
 await rpc('service_reward_sponsor_lifecycle_v4',scope);assert.equal(calls[1][0],'service_reward_demo_copy_lifecycle');
 for(const n of ['service_read_reward_sponsor_upload_v4','service_reward_sponsor_lifecycle_v4'])for(const extra of [{p_chain_id:1},{p_actor_user_id:id(9)},{p_actor_session_id:id(9)},{p_private_key:'forbidden'},{p_clock:999}])await assert.rejects(()=>rpc(n,{...scope,...extra}));
 await assert.rejects(()=>rpc('arbitrary',scope));assert.equal(calls.length,2);
 await assert.rejects(()=>hostedCopyUploadRpc(actor,async()=>{throw Error('unexpected');})('service_read_reward_sponsor_upload_v4',{...scope,p_package_text:'{}'}));
});
test('hosted HTTP allows only scoped preparation and publication commitments before any private read',async()=>{
 const {dispatchHostedCopyReviews}=await import('../dist/routes/rewards/hosted-copy-reviews.js');
 const values={APP_BASE_URL:'https://podium.raceson.com',API_CORS_ORIGIN:'https://podium.raceson.com',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:'https://podium.raceson.com',RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{
  let body,response,calls=0;const res={setHeader(){}},deps={config:()=>({chainId:10143}),applyPrivateSessionHeaders(){},requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),readJsonBody:async()=>body,rpc:async()=>{calls++;throw Error('unexpected');},sendSuccess(){throw Error('unexpected');},sendError(_r,status,code){response={status,code};}};
  for(const kind of ['upload','handoff']){
   const url=new URL(`https://podium.raceson.com/api/v1/rewards/demo-copy/reviews/${setupId}/allocations/0/${id(3)}/${kind}`);
   const valid=kind==='upload'?{requestId:id(4),contextHash:'c'.repeat(64),documentHash:'d'.repeat(64)}:{action:'publication',requestId:id(4),documentHash:'d'.repeat(64)};
   assert.equal(hostedCopyRequestAllowed('GET',url,'sponsor-drafts-v1',true),true);assert.equal(hostedCopyRequestAllowed('POST',url,'sponsor-drafts-v1',true),true);assert.equal(hostedCopyRequestAllowed('POST',url,'sponsor-drafts-v1',false),false);
   for(const extra of [{source:{}},{amountWei:'102'},{funding:{funded:true}},{reviewStartedAt:'999'},{package:{}},{transactionHash:'0x'+'a'.repeat(64)},{chainId:1}]){
    body={...valid,...extra};await dispatchHostedCopyReviews({method:'POST'},res,url,deps);assert.equal(response.status,400);
   }
   body={...valid,action:'receipt'};await dispatchHostedCopyReviews({method:'POST'},res,url,deps);assert.equal(response.status,400);
   await dispatchHostedCopyReviews({method:'DELETE'},res,url,deps);assert.equal(response.status,405);
   url.search='?clock=999';assert.equal(hostedCopyRequestAllowed('POST',url,'sponsor-drafts-v1',true),false);
   await dispatchHostedCopyReviews({method:'GET'},res,url,deps);assert.equal(response.status,400);
  }assert.equal(calls,0);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
