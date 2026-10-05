import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidedSetup,addGuidedGroup,bindGuidedSeason} from '@raceson/domain/rewards/guided-setup-editor';
import {SPONSOR_CATEGORY_PRESETS} from '@raceson/domain/rewards/sponsor-source';
import {publishedSnapshot} from './fixtures/published-reward-v2.mjs';
import {sponsorLaunchPlan,sponsorLaunchSourcesReady,decodeSponsorLaunchView} from '@raceson/domain/rewards/sponsor-launch';
import {rewardSponsorLaunch} from '@raceson/db/rewards';
import {dispatchSponsorLaunch} from '../dist/routes/rewards/sponsor-launch.js';
const id=n=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){let seq=10;const next=()=>id(seq++);let configuration=createGuidedSetup(next);
 configuration=addGuidedGroup(configuration,configuration.guided.pots[0].nodeId,'club_metres',next,null);
 configuration.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);configuration.root.children[0].children[0].shareBps=10000;
 return {id:id(1),chainId:10143,revision:1,updatedAt:'2026-09-23T08:00:00.000Z',configuration};}
const launch=setup=>({id:id(3),setup:structuredClone(setup),configurationHash:'a'.repeat(64),createdAt:setup.updatedAt,state:'prepared'});
test('preparation accepts permissionless complete drafts but exposes contract/source incompatibility',()=>{
 const setup=fixture(),p=sponsorLaunchPlan(setup);
 assert.equal(setup.configuration.stage,'draft');assert.equal(p.complete,true);assert.equal(p.hasSourceReferences,false);
 assert.equal(p.needsFlexibleContract,true);assert.equal(p.needsReturnPolicy,true);assert.equal(p.budgetWei,'100000000000000000000000');
 assert.equal(p.pots.reduce((s,p)=>s+BigInt(p.amountWei),0n),BigInt(p.budgetWei));
 setup.configuration.root.children[0].children[0].shareBps=9000;assert.equal(sponsorLaunchPlan(setup).complete,false);
});
test('strict launch read rejects foreign scope, fabricated funded state and divergent same-revision rules',()=>{
 const setup=fixture(),v={setup,launch:launch(setup)};
 assert.deepEqual(decodeSponsorLaunchView(v,10143,id(1)),v);
 for(const change of [v=>v.setup.id=id(88),v=>v.launch.state='funded',v=>v.launch.transactionHash='0xabc',v=>v.launch.setup.configuration.budgetMon='30',v=>v.launch.configurationHash='bad',v=>v.launch.setup.revision=2]){
  const bad=structuredClone(v);change(bad);assert.throws(()=>decodeSponsorLaunchView(bad,10143,id(1)));
 }
 const next=structuredClone(setup);next.revision=2;next.configuration.budgetMon='50';assert.equal(decodeSponsorLaunchView({setup:next,launch:launch(setup)},10143,id(1)).launch.setup.configuration.budgetMon,'100000');
});
test('repository and route derive account/network; no organizer identity or browser supplied manifest',async()=>{
 const setup=fixture();setup.configuration.context={draftId:id(80),catalogueHash:'c'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};let response,calls=0,body={requestId:id(3),expectedRevision:1};
 const rpc=async(name,args)=>{calls++;assert.equal(name,'service_reward_sponsor_launch');assert.equal(args.p_actor_user_id,id(4));assert.equal(args.p_actor_session_id,id(5));assert.equal(args.p_chain_id,10143);return{data:{setup,launch:args.p_request_id?launch(setup):null},error:null};};
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(4),sessionId:id(5)}),rpc,readJsonBody:async()=>body,
  applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/launch`),res={setHeader(){}};
 await dispatchSponsorLaunch({method:'POST'},res,url,deps);assert.equal(response.status,200);assert.equal(response.data.launch.state,'prepared');
 for(const extra of [{ownerUserId:id(9)},{contractAddress:'0xabc'},{configuration:setup.configuration}]){
  body={requestId:id(3),expectedRevision:1,...extra};await dispatchSponsorLaunch({method:'POST'},res,url,deps);assert.equal(response.status,400);
 }
 assert.equal(calls,2);
 await dispatchSponsorLaunch({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,2);
 await dispatchSponsorLaunch({method:'DELETE'},res,url,deps);assert.equal(response.status,405);
 await assert.rejects(()=>rewardSponsorLaunch({userId:id(4),sessionId:id(5)},10143,id(1),{requestId:id(3),expectedRevision:2},rpc));
});

test('current lifecycle may change while the frozen rules must still match exactly',()=>{
 const setup=fixture(),frozen=launch(setup);setup.lifecycle={state:'saved',canDelete:false};
 assert.equal(decodeSponsorLaunchView({setup,launch:frozen},10143,id(1)).setup.lifecycle.state,'saved');
 frozen.setup.configuration.budgetMon='30';
 assert.throws(()=>decodeSponsorLaunchView({setup,launch:frozen},10143,id(1)));
});

test('new unbound launches reject before any write, but legacy launch retries remain readable',async()=>{
 const setup=fixture(),actor={userId:id(4),sessionId:id(5)};let writes=0;
 const rpc=async(_name,args)=>{if(args.p_request_id)writes++;return{data:{setup,launch:null},error:null};};
 assert.equal(sponsorLaunchSourcesReady(setup),false);
 await assert.rejects(rewardSponsorLaunch(actor,10143,id(1),{requestId:id(3),expectedRevision:1},rpc),{code:'reward_launch_sources_required'});assert.equal(writes,0);
 const legacy=async()=>({data:{setup,launch:launch(setup)},error:null});
 assert.equal((await rewardSponsorLaunch(actor,10143,id(1),{requestId:id(3),expectedRevision:1},legacy)).launch.id,id(3));
 setup.configuration.context={draftId:id(80),catalogueHash:'c'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};
 assert.equal(sponsorLaunchSourcesReady(setup),true,'participation rules do not need a category reference');
 setup.configuration.root.children[0].shareBps=5000;setup.configuration.root.children[1].shareBps=5000;
 assert.equal(sponsorLaunchSourcesReady(setup),false,'funded rounds need source IDs');
});

test('ranked launch requires each funded group to reference its mapped round and catalogue',()=>{
 const setup=fixture();let seq=200;
 setup.configuration.context={draftId:id(80),catalogueHash:'c'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};
 setup.configuration.guided.pots[1].roundId=id(81);
 setup.configuration=addGuidedGroup(setup.configuration,setup.configuration.guided.pots[1].nodeId,'athlete_standings',()=>id(seq++),{id:id(82),target:'individual',competitionName:'Long',name:'Men'});
 setup.configuration.root.children[0].shareBps=5000;setup.configuration.root.children[1].shareBps=5000;
 setup.configuration.root.children[1].children[0].shareBps=10000;
 assert.equal(sponsorLaunchSourcesReady(setup),true);
 assert.equal(sponsorLaunchPlan(setup).complete,true);
 const missing=structuredClone(setup);missing.configuration.root.children[1].children[0].rule.source=null;
 assert.equal(sponsorLaunchSourcesReady(missing),false);
 const unfunded=structuredClone(missing);unfunded.configuration.root.children[0].shareBps=10000;unfunded.configuration.root.children[1].shareBps=0;
 assert.equal(sponsorLaunchSourcesReady(unfunded),true,'unfunded group does not prevent launch');
 for(const change of [source=>source.draftId=id(83),source=>source.catalogueHash='d'.repeat(64),source=>source.roundId=id(84)]){
  const wrong=structuredClone(setup);change(wrong.configuration.root.children[1].children[0].rule.source);
  assert.throws(()=>sponsorLaunchSourcesReady(wrong),'foreign sources fail strict setup decoding');
 }
});

test('launch route explains missing sources without writing a launch',async()=>{
 const setup=fixture();let response,writes=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(4),sessionId:id(5)}),
  rpc:async(_name,args)=>{if(args.p_request_id)writes++;return {data:{setup,launch:null},error:null};},
  readJsonBody:async()=>({requestId:id(3),expectedRevision:1}),applyPrivateSessionHeaders:()=>{},
  sendSuccess:()=>assert.fail('unbound launch must not succeed'),sendError:(_r,status,code,message)=>response={status,code,message}};
 await dispatchSponsorLaunch({method:'POST'},{setHeader(){}},new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/launch`),deps);
 assert.equal(response.status,409);assert.equal(response.code,'reward_launch_sources_required');
 assert.match(response.message,/Connect the official league/);assert.equal(writes,0);
});

function trackFixture(){
 const setup=fixture(),snapshot=publishedSnapshot(),catalogue=snapshot.catalogue;
 catalogue.rounds.push({...catalogue.rounds[0],id:id(400),editionId:id(401),slot:5});
 catalogue.categories=[...Array.from({length:7},(_,i)=>({...catalogue.categories[0],id:id(420+i),competitionId:i===6?id(499):catalogue.categories[0].competitionId})),catalogue.categories[1]];
 const round=catalogue.rounds[2],track=round.races[0],context={draftId:id(80),catalogueHash:'c'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};
 let seq=500;setup.configuration=bindGuidedSeason(createGuidedSetup(()=>id(seq++)),context,catalogue);
 setup.configuration.sponsorSelection={sourceLeagueId:snapshot.sourceLeagueId,sourceSeasonId:snapshot.sourceSeasonId,eventEditionId:round.editionId,raceId:track.id};
 setup.configuration.root.children.forEach((p,i)=>p.shareBps=i===3?10000:0);
 setup.configuration=addGuidedGroup(setup.configuration,setup.configuration.guided.pots[3].nodeId,'athlete_standings',()=>id(seq++),catalogue.categories[0]);
 setup.configuration.root.children[3].children[0].shareBps=10000;
 const source={schema:'raceson-sponsor-source-v4',sourceLeagueId:snapshot.sourceLeagueId,sourceSeasonId:snapshot.sourceSeasonId,eventEditionId:round.editionId,
  context,catalogue,selectedRoundId:round.id,selectedSlot:round.slot,categoryPresets:Object.fromEntries(SPONSOR_CATEGORY_PRESETS.map((key,i)=>[key,catalogue.categories[i].id]))};
 return {setup,source};
}
test('track launch verifies published event, track, funded round and category before freezing',async()=>{
 const actor={userId:id(4),sessionId:id(5)},change={requestId:id(3),expectedRevision:1};
 for(const mutate of [null,
  ({setup})=>{setup.configuration.sponsorSelection.raceId=id(999);},
  ({setup})=>{setup.configuration.root.children[0].shareBps=100;setup.configuration.root.children[3].shareBps=9900;},
  ({setup,source})=>{setup.configuration.root.children[3].children[0].rule.source.categoryId=source.catalogue.categories[6].id;},
  ({setup})=>{setup.configuration.root.children[3].children[0].rule.source.categoryId=id(998);},
  ({setup})=>{setup.configuration.context.catalogueHash='d'.repeat(64);setup.configuration.root.children[3].children[0].rule.source.catalogueHash='d'.repeat(64);},
  ({setup})=>{setup.configuration.guided.pots[3].roundId=id(997);setup.configuration.root.children[3].children[0].rule.source.roundId=id(997);},
 ]){
  const f=trackFixture();mutate?.(f);let writes=0,sourceReads=0;
  const rpc=async(name,args)=>{
   if(name==='service_resolve_reward_sponsor_source_v4'){
    sourceReads++;assert.equal(args.p_event_edition_id,f.setup.configuration.sponsorSelection.eventEditionId);assert.equal(args.p_setup_id,null);
    return {data:f.source,error:null};
   }
   assert.equal(name,'service_reward_sponsor_launch');if(args.p_request_id)writes++;
   return {data:{setup:f.setup,launch:args.p_request_id?launch(f.setup):null},error:null};
  };
  if(mutate){await assert.rejects(rewardSponsorLaunch(actor,10143,id(1),change,rpc),{code:'reward_launch_sources_required'});assert.equal(writes,0);}
  else {assert.equal((await rewardSponsorLaunch(actor,10143,id(1),change,rpc)).launch.state,'prepared');assert.equal(writes,1);}
  assert.equal(sourceReads,1);
 }
});
test('unpublished track sources fail closed, while frozen track retries retain their original rules',async()=>{
 const {setup}=trackFixture(),actor={userId:id(4),sessionId:id(5)},change={requestId:id(3),expectedRevision:1};let writes=0;
 for(const message of ['reward_sponsor_source_not_found','reward_sponsor_source_stale']){
  const rpc=async(name,args)=>{
   if(name==='service_resolve_reward_sponsor_source_v4')return {data:null,error:{message}};
   if(args.p_request_id)writes++;return {data:{setup,launch:null},error:null};
  };
  await assert.rejects(rewardSponsorLaunch(actor,10143,id(1),change,rpc),{code:'reward_launch_sources_required'});
 }
 assert.equal(writes,0);
 const retry=async name=>{assert.equal(name,'service_reward_sponsor_launch');return {data:{setup,launch:launch(setup)},error:null};};
 assert.equal((await rewardSponsorLaunch(actor,10143,id(1),change,retry)).launch.id,id(3));
});
