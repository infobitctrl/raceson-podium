import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSponsorSourceRequestV4,decodeSponsorSourceViewV4,SPONSOR_CATEGORY_PRESETS} from '@raceson/domain/rewards/sponsor-source';
import {resolveSponsorSourceV4} from '@raceson/db/rewards';
import {dispatchSponsorSourceV4} from '../dist/routes/rewards/sponsor-source-v4.js';
const id=n=>`8f240924-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const categories=SPONSOR_CATEGORY_PRESETS.map((key,i)=>({id:id(100+i),competitionId:id(key==='clubs'?9:8),competitionName:'Published demo competition',name:key,target:key==='clubs'?'club':'individual',eligibility:{}}));
 return {schema:'raceson-sponsor-source-v4',sourceLeagueId:id(1),sourceSeasonId:id(2),eventEditionId:null,
  context:{draftId:id(3),catalogueHash:'a'.repeat(64),roundId:null,editionId:null,programmeName:'Published demo league',eventName:'Published demo league'},
  catalogue:{categories,rounds:Array.from({length:5},(_,i)=>({id:id(20+i),editionId:id(30+i),slot:i+1,name:`Round ${i+1}`,date:'2026-10-04',status:i===4?'draft':'completed',races:[]}))},
  selectedRoundId:null,selectedSlot:null,categoryPresets:Object.fromEntries(SPONSOR_CATEGORY_PRESETS.map((key,i)=>[key,id(100+i)]))};
}
const identity={userId:id(4),sessionId:id(5)},selection={sourceLeagueId:id(1),sourceSeasonId:id(2),eventEditionId:null};
test('source request accepts exact discovery identity or owned setup only',()=>{
 assert.deepEqual(decodeSponsorSourceRequestV4(selection),selection);
 assert.deepEqual(decodeSponsorSourceRequestV4({setupId:id(6)}),{setupId:id(6)});
 for(const request of [{draftId:id(3)},{...selection,setupId:id(6)},{...selection,label:'Šibenik'},{...selection,chainId:10143},{...selection,eventEditionId:undefined},{...selection,sourceSeasonId:'arbitrary'}])assert.throws(()=>decodeSponsorSourceRequestV4(request));
});
test('published source decoder rejects private fields and invalid selections or preset categories',()=>{
 const good=fixture();assert.deepEqual(decodeSponsorSourceViewV4(good),good);
 for(const change of [r=>r.record={rules:{}},r=>r.context.rules={},r=>r.selectedSlot=1,r=>r.categoryPresets.clubs=id(100),r=>r.categoryPresets.long_female=id(999),r=>r.catalogue.rounds[4].status='cancelled']){
  const bad=structuredClone(good);change(bad);assert.throws(()=>decodeSponsorSourceViewV4(bad));
 }
 const event={...good,eventEditionId:id(999),selectedRoundId:id(24),selectedSlot:5};
 assert.equal(decodeSponsorSourceViewV4(event).selectedSlot,5,'public event may map to its explicit local planning copy');
});
test('repository derives session and network without organizer identity or arbitrary private draft access',async()=>{
 let args;
 const rpc=async(name,input)=>{assert.equal(name,'service_resolve_reward_sponsor_source_v4');args=input;return{data:fixture(),error:null};};
 assert.equal((await resolveSponsorSourceV4(identity,10143,selection,rpc)).context.draftId,id(3));
 assert.deepEqual(args,{p_actor_user_id:id(4),p_actor_session_id:id(5),p_chain_id:10143,p_setup_id:null,p_source_league_id:id(1),p_source_season_id:id(2),p_event_edition_id:null});
 await resolveSponsorSourceV4(identity,10143,{setupId:id(6)},rpc);assert.equal(args.p_setup_id,id(6));assert.equal(args.p_source_league_id,null);
 await assert.rejects(resolveSponsorSourceV4(identity,10143,{...selection,sourceLeagueId:id(999)},rpc),/invalid_reward_sponsor_source/);
});
test('route requires authentication and strictly rejects mixed identities, query parameters and unsupported methods',async()=>{
 let body=selection,response,calls=0,privateHeaders=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>identity,readJsonBody:async()=>body,
  applyPrivateSessionHeaders:()=>privateHeaders++,rpc:async()=>{calls++;return{data:fixture(),error:null};},
  sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const url=new URL('http://local/api/v1/rewards/sponsor-sources/resolve'),res={setHeader(){}};
 await dispatchSponsorSourceV4({method:'POST'},res,url,deps);assert.equal(response.status,200);assert.equal(calls,1);
 body={...selection,setupId:id(6)};await dispatchSponsorSourceV4({method:'POST'},res,url,deps);assert.equal(response.status,400);assert.equal(calls,1);
 await dispatchSponsorSourceV4({method:'POST'},res,new URL(`${url}?sourceSeasonId=${id(2)}`),deps);assert.equal(response.status,400);
 await dispatchSponsorSourceV4({method:'POST'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);
 await dispatchSponsorSourceV4({method:'GET'},res,url,deps);assert.equal(response.status,405);assert.equal(calls,1);assert.equal(privateHeaders,5);
});
test('route gives bounded missing/stale failures without leaking database diagnostics',async()=>{
 for(const [message,status,code] of [['reward_sponsor_source_not_found',404,'reward_sponsor_source_not_found'],['reward_sponsor_source_stale',409,'reward_sponsor_source_stale'],['private database details',503,'reward_sponsor_source_unavailable']]){
  let reply;
  await dispatchSponsorSourceV4({method:'POST'},{setHeader(){}},new URL('http://local/api/v1/rewards/sponsor-sources/resolve'),{
   config:()=>({chainId:10143}),requireIdentity:async()=>identity,readJsonBody:async()=>selection,applyPrivateSessionHeaders(){},
   rpc:async()=>({data:null,error:{message}}),sendSuccess:()=>assert.fail('failure must not resolve'),sendError:(_r,status,code,message)=>reply={status,code,message},
  });assert.equal(reply.status,status);assert.equal(reply.code,code);assert.doesNotMatch(reply.message,/private database/);
 }
});
