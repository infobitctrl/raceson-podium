import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createPrivyTestnetPilotV3, privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { readNativeFinaleSourceV3 } from "@raceson/db/rewards";
import { leaguePolicyWorkspaceV3 } from "../../../apps/api/dist/features/rewards/league-policy-v3-service.js";
import { nativeContinuityReviewV3 } from "../../../apps/api/dist/features/rewards/native-finale-continuity-service.js";
import { leaguePublicationV3 } from "../../../apps/api/dist/features/rewards/league-publication-v3-service.js";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { assertLocalStack, localSql } from "./local-demo.mjs";
import { privyPilotOrganization as org } from "./seed-privy-testnet-pilot.mjs";
const q = v => `'${String(v).replaceAll("'", "''")}'`;
export const finaleSourceIds = Object.freeze({ policy: id(830001), continuity: id(830002), league: id(830003) });

/** Invented, explicitly labelled practice results, using only the approved ten
 * synthetic profiles. Never accepts real IDs, addresses, dates or result input. */
export function privyFinaleFixture(capturedAt) {
  const pilot = createPrivyTestnetPilotV3(capturedAt);
  const policy = { schema: "raceson-league-scoring-policy-v3", categories: pilot.snapshot.catalogue.categories.slice(0, 7).map((c, i) => ({
    categoryId: c.id, points: Array.from({ length: 25 }, (_, rank) => i < 5 ? 100 - 3 * rank : 150 - 4 * rank),
    participationPoints: 0, bestN: 5, minimumRounds: 1, tieBreak: "best_finish" })), club: { categoryId: id(8), membersPerRound: 3 } };
  const races = [0, 1].map(course => {
    const raceId = id(55 + course), runId = id(831000 + course);
    const athletes = pilot.athletes.map(a => ({ ...a, categoryId: pilot.snapshot.results.find(r => r.athleteId === a.id).classificationIds[0] }))
      .filter(a => pilot.snapshot.catalogue.categories.find(c => c.id === a.categoryId).competitionId === id(60 + course))
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.id.localeCompare(b.id));
    return { raceId, runId, competitionId: id(60 + course), rows: athletes.map((a, rank) => ({
      id: id(832000 + course * 100 + rank), registrationId: id(833000 + course * 100 + rank), athleteId: a.id,
      categoryId: a.categoryId, clubId: a.clubId, finishTimeMs: (course ? 3600000 : 1800000) + rank * 13000, rankOverall: rank + 1 })) };
  });
  const fixtureHash = createHash("sha256").update(JSON.stringify({ schema: "privy-synthetic-finale-v1", races })).digest("hex");
  return { pilot, policy, races, fixtureHash };
}

/** Atomic fixture-only insert. Existing runs are never replaced, and all
 * subsequent reads independently compare their exact rows before publication. */
export function finaleFixtureSql(f, actor, rollback = false) {
  assert.deepEqual(f, privyFinaleFixture(f.pilot.snapshot.capturedAt));
  assert.match(actor, /^[0-9a-f-]{36}$/);
  const raceList = f.races.map(r => q(r.raceId)).join(",");
  return `begin; do $finale$ begin
    perform pg_advisory_xact_lock(hashtextextended(${q(id(52))},0));
    if not exists(select 1 from public.account_login_identifiers a join public.organization_memberships m on m.user_id=a.user_id
      where a.username='demo.organizer' and a.user_id=${q(actor)} and m.organization_id=${q(org)} and m.role='owner' and m.status='active')
      or not app_private.reward_privy_synthetic_programme_v3(${q(id(52))},10143)
      then raise exception 'synthetic_finale_scope_required'; end if;
    if exists(select 1 from public.result_runs where event_category_id in (${raceList})) then
      if (select count(*) from public.result_runs where event_category_id in (${raceList}))<>2
        or exists(select 1 from public.result_runs where event_category_id in (${raceList}) and
          summary_json->>'syntheticFinaleHash' is distinct from ${q(f.fixtureHash)}) then raise exception 'synthetic_finale_changed'; end if;
      return;
    end if;
    if not exists(select 1 from public.event_editions e join public.event_series s on s.id=e.event_series_id
      where e.id=${q(id(54))} and s.organization_id=${q(org)} and e.status='draft' and e.published_at is null
      and e.name='Round 5 · Synthetic finale rehearsal' and e.results_visibility='private')
      or exists(select 1 from public.registrations where event_category_id in (${raceList}))
      or exists(select 1 from public.result_publications where event_category_id in (${raceList}))
      then raise exception 'synthetic_finale_empty_fixture_required'; end if;
    ${f.pilot.snapshot.clubs.map(c => `insert into public.clubs(id,slug,name,description) values(${q(c.clubId)},
      ${q(`privy-synthetic-club-${c.clubId.slice(-4)}`)},${q(c.name)},'Synthetic test club; no real owners or treasury.');`).join("\n")}
    update public.event_editions set is_practice=true,public_visibility='private',status='completed' where id=${q(id(54))};
    update public.event_categories set status='completed' where id in (${raceList}) and event_edition_id=${q(id(54))};
    ${f.races.map(r => `insert into public.result_runs(id,event_category_id,trigger_type,status,completed_at,summary_json)
      values(${q(r.runId)},${q(r.raceId)},'manual','succeeded',clock_timestamp(),jsonb_build_object('syntheticFinaleHash',${q(f.fixtureHash)}));
      ${r.rows.map(row => `insert into public.registrations(id,event_category_id,athlete_profile_id,represented_club_id,status,participation_status,result_status,source)
        values(${q(row.registrationId)},${q(r.raceId)},${q(row.athleteId)},${q(row.clubId)},'confirmed','finished','official','direct');
        insert into public.result_rows(id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,rank_overall,represented_club_id)
        values(${q(row.id)},${q(r.runId)},${q(row.registrationId)},${q(row.athleteId)},${q(r.raceId)},'official',${row.finishTimeMs},${row.rankOverall},${q(row.clubId)});`).join("\n")}`).join("\n")}
  end $finale$; ${rollback ? "rollback" : "commit"};`;
}

function savedFixture() {
  const captured = JSON.parse(localSql(`begin read only; select to_jsonb(payload->>'capturedAt') from app_private.reward_public_snapshots_v2 where season_id=${q(id(51))}; commit;`));
  return privyFinaleFixture(captured);
}
function verifyRows(f) {
  const actual = JSON.parse(localSql(`begin read only; select jsonb_agg(jsonb_build_object('id',r.id,'runId',r.result_run_id,
    'registrationId',r.registration_id,'athleteId',r.athlete_profile_id,'raceId',r.event_category_id,'clubId',r.represented_club_id,
    'finishTimeMs',r.finish_time_ms,'rankOverall',r.rank_overall,'status',r.result_status,'participation',g.participation_status)
    order by r.id) from public.result_rows r join public.registrations g on g.id=r.registration_id
    where r.event_category_id in(${q(id(55))},${q(id(56))}); commit;`));
  const expected = f.races.flatMap(r => r.rows.map(({categoryId: _, ...row}) => ({ ...row, runId:r.runId,raceId:r.raceId,status:"official",participation:"finished" }))).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(actual, expected, "synthetic_finale_rows_changed");
}
export async function runFinaleSource(action) {
  assert.ok(["inspect","check-fixture","seed","policy","publish-races","continuity","publish-league"].includes(action));
  assertLocalStack(); const f=savedFixture(), s=await localOrganizer(id(52));
  try {
    if(action==="check-fixture"||action==="seed") {
      const before=JSON.parse(localSql(`begin read only;select count(*)::int from public.result_rows where event_category_id in(${q(id(55))},${q(id(56))});commit;`));
      localSql(finaleFixtureSql(f,s.identity.userId,action==="check-fixture"));
      if(action==="seed")verifyRows(f);
      else assert.equal(JSON.parse(localSql(`begin read only;select count(*)::int from public.result_rows where event_category_id in(${q(id(55))},${q(id(56))});commit;`)),before);
      return {action,fixtureHash:f.fixtureHash,rows:10,committed:action==="seed"};
    }
    if(action==="policy") {
      const v=await leaguePolicyWorkspaceV3(s.identity,10143,id(52),undefined,s.rpc);
      if(v.review){assert.equal(v.review.id,finaleSourceIds.policy);assert.deepEqual(v.review.policy,f.policy);return {action,state:v.reviewState};}
      const saved=await leaguePolicyWorkspaceV3(s.identity,10143,id(52),{requestId:finaleSourceIds.policy,expectedReviewId:null,contextHash:v.contextHash,decision:"selected",policy:f.policy},s.rpc);
      return {action,state:saved.reviewState,proposalState:saved.proposal?.state};
    }
    if(action==="publish-races") {
      verifyRows(f);
      for(const [i,r] of f.races.entries())for(const [stage,state] of ["provisional","official"].entries()) {
        const native=await readNativeFinaleSourceV3(s.identity,10143,id(52),s.rpc),current=native.document.races.find(x=>x.raceId===r.raceId);
        assert.equal(current.review.reviewSeconds,0);assert.equal(current.review.held,false);
        if(current.publication?.state==="official")continue;
        if(state==="provisional"&&current.publication?.state==="provisional")continue;
        const response=await s.rpc("service_publish_result_run_with_workflows",{p_event_category_id:r.raceId,p_result_run_id:r.runId,
          p_publication_state:state,p_published_by_user_id:s.identity.userId,p_change_note:"Synthetic ten-athlete finale rehearsal; not real Si Trail results.",p_client_event_id:id(834000+i*10+stage)});
        assert.equal(response.error,null,"synthetic_publication_failed");
      }
    }
    if(action==="continuity") {
      verifyRows(f); const v=await nativeContinuityReviewV3(s.identity,10143,id(52),undefined,s.rpc);
      assert.equal(v.sourceReady,true);
      const selection={schema:"raceson-native-finale-continuity-v3",athletes:f.pilot.athletes.map(a=>({nativeAthleteId:a.id,target:{kind:"historical",beneficiaryId:a.id}})),
        clubs:f.pilot.snapshot.clubs.map(c=>({nativeClubId:c.clubId,target:{kind:"historical",beneficiaryId:c.clubId}})),
        classifications:f.races.flatMap(r=>r.rows.map(row=>({resultId:row.id,categoryId:row.categoryId})))};
      if(v.review)assert.equal(v.review.id,finaleSourceIds.continuity);
      else await nativeContinuityReviewV3(s.identity,10143,id(52),{requestId:finaleSourceIds.continuity,expectedReviewId:null,contextHash:v.contextHash,decision:"confirmed",selection},s.rpc);
    }
    if(action==="publish-league") {
      const v=await leaguePublicationV3(s.identity,{chainId:10143,draftId:id(52)},undefined,s.rpc);assert.equal(v.sourceReady,true);
      if(v.publication)assert.equal(v.publication.id,finaleSourceIds.league);
      else await leaguePublicationV3(s.identity,{chainId:10143,draftId:id(52)},{requestId:finaleSourceIds.league,expectedPublicationId:null,documentHash:v.documentHash,decision:"published"},s.rpc);
    }
    const native=await readNativeFinaleSourceV3(s.identity,10143,id(52),s.rpc),policy=await leaguePolicyWorkspaceV3(s.identity,10143,id(52),undefined,s.rpc),league=await leaguePublicationV3(s.identity,{chainId:10143,draftId:id(52)},undefined,s.rpc);
    return {action,native:native.inspection,policyState:policy.reviewState,proposalState:policy.proposal?.state,holds:policy.proposal?.holds,
      leaguePublished:league.finalPublished,leagueDocumentHash:league.documentHash,leaguePublicationId:league.publication?.id??null,payableWei:"0"};
  } finally {await s.signOut();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{assert.equal(process.argv.length,3);console.log(JSON.stringify(await runFinaleSource(process.argv[2])));}
  catch(e){console.error(JSON.stringify({error:e.code??e.message}));process.exitCode=1;}
}
