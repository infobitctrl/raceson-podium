import assert from "node:assert/strict";
import { createDefaultRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { localSql } from "./local-demo.mjs";
import { pathToFileURL } from "node:url";

// Explicit opt-in local UI fixture, not a migration or real league mapping.
// Creates planned races only: no athletes, results, review evidence, wallets,
// approvals, deployment registry or funded balances. Existing programmes remain.
const org="82000000-0000-4000-8000-000000000002";
const q=value=>`'${String(value).replaceAll("'","''")}'`;
export function seedSyntheticFundingDemo(rehearsal = false) {
  assert.equal(typeof rehearsal,"boolean");
  const id=n=>`${rehearsal ? "88000000" : "87000000"}-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const slug=rehearsal ? "synthetic-funded-programme" : "synthetic-funding-approval";
  const label=rehearsal ? "Funded programme rehearsal · Synthetic" : "Funding approval rehearsal · Synthetic";
  const existing=JSON.parse(localSql(`select to_jsonb(exists(select 1 from app_private.reward_planning_drafts where id=${q(id(5))}))`));
  if(existing)console.log(`Synthetic funding approval draft already exists: ${id(5)}. No data reset or overwritten.`);
  else {
    const sql=[`begin;`, `do $$ begin if not exists(select 1 from public.organizations where id=${q(org)} and slug='si-trail-demo')
      then raise exception 'Missing local synthetic organization'; end if; end $$;`,
      `insert into public.leagues(id,organization_id,slug,name,status,description) values(${q(id(3))},${q(org)},${q(slug)},
        ${q(label)},'active','Local five-round funding specification test. All races are invented, unrun and without results. Not the real Ši Trail League.');`,
      `insert into public.league_seasons(id,league_id,year,name,status) values(${q(id(4))},${q(id(3))},2026,'Synthetic funding rehearsal','active');`,
      `insert into public.event_series(id,organization_id,slug,name,status) values(${q(id(6))},${q(org)},${q(slug)},
        ${q(label)},'active');`];
    const families=[{id:10,name:"Long",target:"individual",categories:["Female","Male"]},
      {id:11,name:"Short",target:"individual",categories:["Female U16","Male U16","Female","Male","Seniors"]},
      {id:12,name:"Clubs",target:"club",categories:["Clubs"]}];
    const categories=[];
    for(const [f,family] of families.entries()) {
      sql.push(`insert into public.league_competitions(id,league_season_id,slug,name,scoring_target,status,display_order)
        values(${q(id(family.id))},${q(id(4))},${q(`synthetic-${family.id}`)},${q(`${family.name} · Synthetic`)},${q(family.target)},'draft',${f});`);
      for(const [c,name] of family.categories.entries()){
        const categoryId=id(100+f*10+c);categories.push({categoryId,shareBps:family.target==="club"?10000:(categories.length===6?1426:1429)});
        sql.push(`insert into public.league_classifications(id,league_competition_id,slug,name,status,display_order,eligibility_json)
          values(${q(categoryId)},${q(id(family.id))},${q(`synthetic-${c}`)},${q(name)},'draft',${c},'{"demoOnly":true,"sportingApproval":"not-applicable-synthetic"}');`);
      }
    }
    const mapping={version:2,leagueCategories:categories,rounds:[]};
    for(let round=1;round<=5;round++){
      const base=1000+round*10;
      sql.push(`insert into public.event_editions(id,event_series_id,slug,name,start_date,status,results_visibility)
        values(${q(id(base))},${q(id(6))},${q(`synthetic-${round}`)},${q(`Round ${round} · Synthetic funding rehearsal`)},
        ${q(round===5?"2026-10-03":"2026-09-01")},'draft','private');`,
        `insert into public.league_round_events(id,league_season_id,event_edition_id,round_number,status,notes)
          values(${q(id(base+1))},${q(id(4))},${q(id(base))},${round},'draft','Synthetic planned scope only. Not a real event or sporting result.');`);
      for(let race=0;race<2;race++)sql.push(`insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status)
        values(${q(id(base+2+race))},${q(id(base))},${q(`synthetic-${race}`)},${q(`${race===0?"Long":"Short"} · Synthetic`)},${race===0?15:7},'draft');
        insert into public.league_round_race_mappings(league_round_event_id,league_competition_id,event_category_id,status)
          values(${q(id(base+1))},${q(id(10+race))},${q(id(base+2+race))},'mapped');`);
      mapping.rounds.push({slot:round,roundId:id(base+1),categories});
    }
    const actor=`(select m.user_id from public.organization_memberships m join public.account_login_identifiers a on a.user_id=m.user_id
      where m.organization_id=${q(org)} and m.role='owner' and m.status='active' and a.username='demo.organizer')`;
    sql.push(`insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(id(5))},${q(org)},${q(id(4))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${actor});`,
      `insert into app_private.reward_source_mappings_v2(draft_id,revision,mapping,catalogue_hash,rules_revision,updated_by_user_id)
        values(${q(id(5))},1,${q(JSON.stringify(mapping))}::jsonb,
          encode(sha256(convert_to(app_private.reward_mapping_catalogue_v2(${q(id(4))},${q(org)})::text,'UTF8')),'hex'),1,${actor});`,"commit;");
    localSql(sql.join("\n"));
    console.log(`Created synthetic five-round funding approval rehearsal: ${id(5)}. Seven athlete categories plus clubs. Zero results, wallets, approvals or transactions.`);
  }
  return id(5);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { assert.equal(process.argv.length,2,"This fixed local fixture accepts no inputs"); seedSyntheticFundingDemo(); }
  catch { console.error("Synthetic funding rehearsal seed failed; no credentials or private rows logged.");process.exitCode=1; }
}
