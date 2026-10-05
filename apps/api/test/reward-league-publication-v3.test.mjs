import assert from 'node:assert/strict';
import test from 'node:test';
import {createRewardAllocationRehearsalV3} from '../../../packages/domain/dist/rewards/allocation-rehearsal-v3.js';
import {previewRewardAllocationV3} from '../../../packages/domain/dist/rewards/allocation-preview-v3.js';
import {leaguePublicationHashV3} from '../../../packages/db/dist/rewards/index.js';
import {buildLeaguePublicationDocumentV3,decodeLeaguePublicationDocumentV3,publishedLeagueSourceV3,leaguePublicationRequestV3} from '../dist/features/rewards/league-publication-v3-service.js';
import {dispatchLeaguePublicationV3} from '../dist/routes/rewards/league-publication-v3.js';
const id=n=>`8f800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(stage='five_rounds'){
  const f=createRewardAllocationRehearsalV3(stage,'compact_20');f.source.league=null;f.source.standings=f.source.standings.filter(t=>t.slot!==null);
  const context={schema:'raceson-league-policy-context-v3',draftId:id(1),organizationId:id(2),chainId:31337,rulesRevision:1,rules:f.rules,mapping:f.mapping,
    sourceLeagueId:f.source.sourceLeagueId,sourceSeasonId:f.source.sourceSeasonId,categories:f.source.categories.map(c=>({...c,competitionId:id(3)})),
    rounds:f.source.rounds.map(r=>({id:r.roundId,slot:r.slot,editionId:id(10+r.slot),races:[]}))};
  const policy={schema:'raceson-league-scoring-policy-v3',categories:f.policy.pointsTables.map(p=>({categoryId:p.categoryId,points:p.points,
    participationPoints:0,bestN:4,minimumRounds:2,tieBreak:'best_finish'})),club:{categoryId:f.source.categories.find(c=>c.target==='club').id,membersPerRound:3}};
  const review={id:id(20),previousReviewId:null,contextHash:leaguePublicationHashV3(context),policy,decision:'selected',reviewedAt:'2026-09-10T01:00:00.000Z'};
  return{...f,context,review};
}
const document=f=>buildLeaguePublicationDocumentV3(f.context,f.review,f.source);
const publication=d=>({id:id(30),draftId:id(1),previousPublicationId:null,sourceGuardHash:'a'.repeat(64),documentHash:leaguePublicationHashV3(d),document:d,
  decision:'published',publishedAt:'2026-09-11T00:00:00.000Z',publishedByUserId:id(31),evidenceHash:'b'.repeat(64)});
test('final league document is deterministic and recomputes complete scoring, clubs and kilometre contributions',()=>{
  const f=fixture(),before=structuredClone(f),d=document(f);assert.deepEqual(f,before);assert.deepEqual(decodeLeaguePublicationDocumentV3(d),d);
  assert.equal(d.proposal.athleteTables.length,7);assert.equal(d.proposal.clubTables.length,6);
  f.source.capturedAt='2026-09-11T00:00:00.000Z';assert.deepEqual(document(f),d);
  const source=publishedLeagueSourceV3(publication(d));assert.equal(source.league.evidence.digest,'b'.repeat(64));assert.equal(source.league.roundDigests.length,5);
  assert.equal(source.standings.filter(t=>t.slot===null).length,8);assert.deepEqual(publishedLeagueSourceV3(publication(d)),source);
  const allocation=previewRewardAllocationV3(f.rules,f.mapping,source);
  assert.equal(allocation.league.hold,null);assert.ok(allocation.league.proposedWei>0n);assert.equal(allocation.payableWei,0n);
  assert.equal(allocation.league.participation.totalMetres.toString(),d.proposal.participation.totalMetres);
  assert.equal(allocation.league.budgetWei,allocation.league.proposedWei+allocation.league.retainedWei);
});
test('publication does not create a second review timer or change original round evidence',()=>{
  const f=fixture(),d=document(f),p=publication(d);p.publishedAt=d.source.capturedAt;
  const source=publishedLeagueSourceV3(p);assert.deepEqual(source.rounds,f.source.rounds);
  assert.equal(source.league.evidence.publishedAt,p.publishedAt);
  assert.throws(()=>publishedLeagueSourceV3({...p,publishedAt:'2026-09-09T00:00:00.000Z'}));
});
test('four rounds, held sources and changed policy cannot manufacture an official league document',()=>{
  assert.throws(()=>document(fixture('four_rounds')),/not_ready/);
  for(const edit of [f=>f.source.rounds[4].evidence.held=true,f=>f.source.rounds[1].expectedResultCount++,
    f=>f.review.decision='held',f=>f.context.rulesRevision++,f=>f.source.rounds[2].results[0].status='unknown']){
    const f=fixture();edit(f);assert.throws(()=>document(f));}
  const d=document(fixture());
  for(const edit of [x=>x.proposal.athleteTables[0].rows[0].points++,x=>x.proposal.participation.totalMetres='1',
    x=>x.proposal.clubTables[0].rows[0].rank=10,x=>x.proposal.finalPublished=true,x=>x.source.rounds[0].evidence.digest='c'.repeat(64),
    x=>x.source.rounds[0].results[0].distanceMetres='1']){
    const bad=structuredClone(d);edit(bad);assert.throws(()=>decodeLeaguePublicationDocumentV3(bad));}
});
test('missing official distance retains the entire participation share without discarding final category prizes',()=>{
  const f=fixture('distance_hold'),d=document(f);assert.equal(d.proposal.participation.hold,'missing_distance');
  const a=previewRewardAllocationV3(f.rules,f.mapping,publishedLeagueSourceV3(publication(d))).league;
  assert.equal(a.hold,null);assert.equal(a.participation.hold,'missing_distance');assert.equal(a.participation.proposedWei,0n);
  assert.equal(a.participation.retainedWei,a.participation.budgetWei);assert.ok(a.families.some(f=>f.proposedWei>0n));
});
test('stored league ties are preserved; final-table row IDs are stable and distinct from race results',()=>{
  const f=fixture(),cat=f.review.policy.categories[0].categoryId;
  for(const t of f.source.standings.filter(t=>t.categoryId===cat))t.rows.forEach((r,i)=>r.rank=i<2?1:i+1);
  const p=publication(document(f)),s=publishedLeagueSourceV3(p),table=s.standings.find(t=>t.slot===null&&t.categoryId===cat);
  assert.deepEqual(table.rows.slice(0,2).map(r=>r.rank),[1,1]);
  const resultIds=new Set(s.rounds.flatMap(r=>r.results.map(x=>x.id)));
  assert.ok(table.rows.every(r=>!resultIds.has(r.sourceRowId)));
  const other=publishedLeagueSourceV3({...p,id:id(32)}).standings.find(t=>t.slot===null&&t.categoryId===cat);
  assert.notEqual(other.rows[0].sourceRowId,table.rows[0].sourceRowId);
  assert.throws(()=>publishedLeagueSourceV3({...p,decision:'held'}));
});
test('publication HTTP accepts only explicit exact-document decisions with authenticated no-store access',async()=>{
  const base={requestId:id(40),expectedPublicationId:null,documentHash:'a'.repeat(64),decision:'published'};
  assert.deepEqual(leaguePublicationRequestV3.parse(base),base);
  for(const patch of [{decision:'send'},{document:{}},{source:{}},{publishedAt:'2026-01-01'},{reviewSeconds:0},{walletAddress:'0x123'}])
    assert.throws(()=>leaguePublicationRequestV3.parse({...base,...patch}));
  const run=async({method='GET',query='',body,authError,rpcError}={})=>{
    const res={},calls=[];
    const handled=await dispatchLeaguePublicationV3({method},res,new URL(`http://127.0.0.1:3101/api/v1/organizer/rewards/drafts/${id(1)}/league-publication${query}`),{
      config:()=>({chainId:31337}),requireIdentity:async()=>{if(authError)throw Error(authError);return{userId:id(31),sessionId:id(41)};},
      readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>res.private=true,
      rpc:async(name,args)=>{calls.push({name,args});return{data:null,error:{message:rpcError??'private-secret-sentinel'}};},
      sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
    });return{res,calls,handled};
  };
  for(const authError of ['Unauthorized','Missing bearer token','reward_account_session_required']){const r=await run({authError});assert.equal(r.res.status,401);assert.equal(r.calls.length,0);}
  assert.equal((await run({authError:'Untrusted browser origin'})).res.status,403);
  assert.equal((await run({query:'?chainId=143'})).res.status,400);
  for(const method of ['PUT','PATCH','DELETE'])assert.equal((await run({method})).handled,false);
  assert.equal((await run({method:'POST',body:{...base,document:{}}})).calls.length,0);
  assert.equal((await run({rpcError:'reward_planning_not_found'})).res.status,404);
  for(const rpcError of ['reward_planning_revision_changed','reward_league_publication_conflict','reward_league_publication_not_ready'])assert.equal((await run({rpcError})).res.status,409);
  const failed=await run();assert.equal(failed.res.status,503);assert.equal(failed.res.private,true);assert.doesNotMatch(JSON.stringify(failed.res),/private-secret/);
});
