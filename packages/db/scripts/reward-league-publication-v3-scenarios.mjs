import assert from 'node:assert/strict';
import {leaguePublicationV3 as publish,readPublishedLeagueSourceV3} from '../../../apps/api/dist/features/rewards/league-publication-v3-service.js';
import {nativeContinuityReviewV3} from '../../../apps/api/dist/features/rewards/native-finale-continuity-service.js';
import {dispatchLeaguePublicationV3} from '../../../apps/api/dist/routes/rewards/league-publication-v3.js';
import {literal as q} from './reward-integration-fixture.mjs';
const id=n=>`8c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function leaguePublicationV3Scenarios({harness,scenario,fixture}){
  const {query,scalar,rpc,rpcSql,lock,waiting}=harness,{identity,draftId,raceId}=fixture,scope={chainId:31337,draftId};
  const run=(change,transport=rpc)=>publish(identity,scope,change,transport);
  const http=async(body,who=identity)=>{
    const res={};assert.equal(await dispatchLeaguePublicationV3({method:body?'POST':'GET'},res,
      new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${draftId}/league-publication`),{
        config:()=>({chainId:31337}),requireIdentity:async()=>who,readJsonBody:async()=>body,rpc,
        applyPrivateSessionHeaders:()=>res.private=true,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),
        sendError:(_,status,code)=>Object.assign(res,{status,code}),
      }),true);assert.equal(res.private,true);return res;
  };
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337,p_draft_id:draftId,p_request_id:null,
    p_decision:null,p_previous_publication_id:null,p_source_guard_hash:null,p_document_text:null};
  let original,request,writerArgs;
  await scenario('league publication refuses unresolved finale/continuity without fabricating a final table',async()=>{
    const v=await run();assert.equal(v.sourceReady,false);assert.equal(v.finalPublished,false);assert.equal(v.leagueAllocation,null);
    await assert.rejects(run({requestId:id(986001),expectedPublicationId:null,documentHash:'a'.repeat(64),decision:'published'}),{code:'reward_league_publication_not_ready'});
    await assert.rejects(readPublishedLeagueSourceV3(identity,scope,rpc),{code:'reward_league_publication_not_ready'});
    assert.equal(await scalar('select count(*) from app_private.reward_league_publications_v3'),0);
  });
  await scenario('five reviewed sources publish one immutable final league table and feed award calculation without wallets',async()=>{
    const native=await nativeContinuityReviewV3(identity,31337,draftId,undefined,rpc);
    await nativeContinuityReviewV3(identity,31337,draftId,{requestId:id(986002),expectedReviewId:native.review.id,
      contextHash:native.contextHash,selection:native.review.selection,decision:'confirmed'},rpc);
    const v=await run();assert.equal(v.sourceReady,true);assert.equal(v.finalPublished,false);assert.equal(v.leagueAllocation,null);
    const profiles=await scalar('select count(*) from public.athlete_profiles');
    request={requestId:id(986003),expectedPublicationId:null,documentHash:v.documentHash,decision:'published'};
    original=await run(request,async(name,a)=>{if(a.p_decision)writerArgs=structuredClone(a);return rpc(name,a);});
    assert.equal(original.finalPublished,true);assert.equal(original.recorded.id,request.requestId);
    assert.equal(original.allocationApproved,false);assert.equal(original.payableWei,'0');
    assert.ok(BigInt(original.leagueAllocation.proposedWei)>0n);assert.equal(original.leagueAllocation.hold,null);
    const source=await readPublishedLeagueSourceV3(identity,scope,rpc);assert.equal(source.source.league.roundDigests.length,5);
    assert.equal(source.source.standings.filter(t=>t.slot===null).length,source.source.categories.length);
    assert.deepEqual((await readPublishedLeagueSourceV3(identity,scope,rpc)).source,source.source);
    assert.equal(await scalar('select count(*) from public.athlete_profiles'),profiles);
    assert.equal((await http(request)).status,200);assert.equal((await http()).data.publication.id,request.requestId);
    assert.doesNotMatch(JSON.stringify(original),/sourceGuardHash|document_text|nativeAthleteId|identityEvidence|signature|privateKey|sessionId/);
    const again=await run(request);assert.deepEqual(again.publication,original.publication);assert.equal(again.documentHash,original.documentHash);
  });
  await scenario('final league SQL rejects mismatched policy, caller timestamps and stale exact-source writes',async()=>{
    const d=JSON.parse(writerArgs.p_document_text);d.policyReview.policy.categories[0].points[0]++;
    let r=await rpc('service_reward_league_publication_v3',{...writerArgs,p_request_id:id(986004),p_previous_publication_id:request.requestId,p_document_text:JSON.stringify(d)});
    assert.equal(r.error.message,'reward_league_publication_not_ready');
    r=await rpc('service_reward_league_publication_v3',{...writerArgs,p_request_id:id(986004),p_previous_publication_id:request.requestId,p_source_guard_hash:'f'.repeat(64)});
    assert.equal(r.error.message,'reward_planning_revision_changed');
    assert.equal((await http({...request,requestId:id(986004),publishedAt:'2026-01-01T00:00:00.000Z'})).status,400);
    assert.equal(await scalar(`select count(*) from app_private.reward_league_publications_v3 where id=${q(id(986004))}`),0);
  });
  await scenario('league publication hold and concurrent corrections preserve one winner and exact retry history',async()=>{
    const held=await run({...request,requestId:id(986005),expectedPublicationId:request.requestId,decision:'held'});
    assert.equal(held.finalPublished,false);assert.equal(held.leagueAllocation,null);
    const retry=await run(request);assert.equal(retry.recorded.id,request.requestId);assert.equal(retry.publication.id,held.publication.id);assert.equal(retry.finalPublished,false);
    assert.equal((await rpc('service_reward_league_publication_v3',writerArgs)).data.publication.id,held.publication.id);
    await assert.rejects(run({...request,decision:'held'}),{code:'reward_league_publication_conflict'});
    const attempts=await Promise.allSettled([986006,986007].map(n=>run({...request,requestId:id(n),expectedPublicationId:held.publication.id})));
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'reward_league_publication_conflict');
  });
  await scenario('native correction between read and publication write aborts; old final table remains held history',async()=>{
    const before=await run();assert.equal(before.finalPublished,true);
    await assert.rejects(run({...request,requestId:id(986008),expectedPublicationId:before.publication.id},async(name,a)=>{
      if(a.p_decision)await query(`update public.result_rows set finish_time_ms=finish_time_ms+1 where id=${q(id(983021))}`);
      return rpc(name,a);
    }),{code:'reward_planning_revision_changed'});
    assert.equal(await scalar(`select count(*) from app_private.reward_league_publications_v3 where id=${q(id(986008))}`),0);
    const stale=await run();assert.equal(stale.finalPublished,false);assert.equal(stale.publication.current,false);assert.equal(stale.leagueAllocation,null);
    assert.equal((await run(request)).recorded.id,request.requestId);
    await assert.rejects(readPublishedLeagueSourceV3(identity,scope,rpc),{code:'reward_league_publication_not_ready'});
    // Explicit hold remains possible even while current source is unresolved.
    const held=await run({requestId:id(986009),expectedPublicationId:stale.publication.id,documentHash:stale.publication.documentHash,decision:'held'});
    assert.equal(held.publication.decision,'held');assert.equal(held.finalPublished,false);
  });
  await scenario('publication read rechecks revoked operator session after an actual source lock wait',async()=>{
    const release=await lock(`select id from public.event_categories where id=${q(raceId)} for update`);
    const pending=assert.rejects(run(),{code:'reward_account_session_required'});pending.catch(()=>{});
    try{await waiting(1);await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(identity.sessionId)}`);}
    finally{await release();}await pending;
    await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(identity.sessionId)}`);
  });
  await scenario('league publication uses invoker-only private SQL, RLS and immutable history',async()=>{
    const table='app_private.reward_league_publications_v3',sig='public.service_reward_league_publication_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,text)';
    assert.equal(await scalar(`select relrowsecurity from pg_class where oid=${q(table)}::regclass`),true);
    assert.equal(await scalar(`select prosecdef from pg_proc where oid=${q(sig)}::regprocedure`),false);
    for(const role of ['anon','authenticated']){
      assert.equal(await scalar(`select has_function_privilege('${role}',${q(sig)},'EXECUTE')`),false);
      assert.equal(await scalar(`select has_table_privilege('${role}',${q(table)},'SELECT,INSERT,UPDATE,DELETE')`),false);
      await assert.rejects(query(`begin;set local role ${role};${rpcSql('service_reward_league_publication_v3',args)}rollback;`),/permission denied/);
    }
    await assert.rejects(query(`update ${table} set decision='held' where id=${q(request.requestId)}`),/immutable/);
    await assert.rejects(query(`delete from ${table} where id=${q(request.requestId)}`),/immutable/);
    const foreign=await rpc('service_reward_league_publication_v3',{...args,p_draft_id:id(999999)});assert.equal(foreign.error.message,'reward_planning_not_found');
  });
}
