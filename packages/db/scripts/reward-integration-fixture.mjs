import { calculationFixture, rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { recordFixture } from "../../../apps/api/test/fixtures/reward-record.mjs";

// Only consumed by the guarded disposable-database integration runner. This is
// synthetic sporting state, never a migration, production seed or real approval.
export const literal = (value) => value === null ? "null" : typeof value === "boolean" ? String(value)
  : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
function insert(table, rows) {
  const keys = Object.keys(rows[0]);
  return `insert into public.${table} (${keys.join(",")}) values ${rows.map((row) =>
    `(${keys.map((key) => typeof row[key] === "object" && row[key] !== null ? json(row[key]) : literal(row[key])).join(",")})`).join(",")};`;
}

export function integrationFixtureSql() {
  const f = calculationFixture("league"); const config = f.configuration; const source = f.source;
  const sql = ["begin;", "set local timezone = 'UTC';"];
  // No usable passwords, sessions or wallets are provisioned for these identities.
  sql.push(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (${literal(id(4))},'reward-operator@example.invalid','authenticated','authenticated','{}','{}',now(),now()),
    (${literal(id(5))},'reward-successor@example.invalid','authenticated','authenticated','{}','{}',now(),now());`);
  // Auth's existing bootstrap trigger creates these profiles. Preserve that
  // behaviour and update only our two synthetic identities, never duplicate it.
  sql.push(`update public.user_profiles set display_name='Synthetic reward operator',status='active',locale='en',timezone='Europe/Zagreb'
    where user_id in (${literal(id(4))},${literal(id(5))});`);
  sql.push(insert("organizations", [{ id: id(1), slug: "reward-integration", name: "Synthetic reward integration", status: "active" }]));
  sql.push(insert("organization_memberships", [{ id: id(8), organization_id: id(1), user_id: id(4), role: "owner",
    membership_type: "permanent", status: "active", joined_at: "2026-01-01T00:00:00Z" }]));
  sql.push(`insert into public.organization_memberships(id,organization_id,user_id,role,membership_type,status,account_template_key,permission_keys)
    values (${literal(id(9))},${literal(id(1))},${literal(id(5))},'admin','permanent','active','organization-admin',
      array['organization.manage','team.manage','events.manage','entrants.manage','race_day.manage','checkpoint_timing.enter',
        'results.manage','communications.manage','safety.manage','logistics.manage','finance.manage']);`);
  sql.push(insert("athlete_profiles", [0, 1, 2, 3, 4, 5, 6].map((n) => ({ id: id(1000 + n), slug: `reward-integration-athlete-${n}`,
    first_name: "Synthetic", last_name: `Runner ${n}`, display_name: `Synthetic runner ${n}`, gender: n === 4 ? "female" : "male",
    birth_year: n === 4 ? null : 1990, status: "active", is_claimed: false }))));
  sql.push(insert("clubs", [{ id: id(2000), slug: "reward-integration-club", name: "Synthetic ownerless club", status: "active" }]));
  sql.push(insert("event_series", [{ id: id(11), organization_id: id(1), slug: "reward-integration", name: "Synthetic reward rounds" }]));
  sql.push(insert("leagues", [{ id: id(2), organization_id: id(1), slug: "reward-integration", name: "Synthetic reward league", status: "active" }]));
  sql.push(insert("league_seasons", [{ id: id(3), league_id: id(2), year: 2026, name: "Synthetic 2026", status: "active" }]));
  sql.push(insert("league_competitions", config.competitions.map((c, n) => ({ id: c.id, league_season_id: id(3), slug: `distance-${n}`,
    name: `Distance ${n}`, scoring_target: c.scoringTarget, result_basis: c.resultBasis, status: "active" }))));
  sql.push(insert("league_classifications", source.classifications.map((c, n) => ({ id: c.id, league_competition_id: c.competitionId,
    slug: `division-${n}`, name: `Synthetic division ${n}`, eligibility_json: c.eligibility, status: "active" }))));
  for (const round of config.rounds) {
    sql.push(insert("event_editions", [{ id: round.eventEditionId, event_series_id: id(11), slug: `synthetic-round-${round.number}`,
      name: `Synthetic round ${round.number}`, start_date: "2026-06-01", status: "completed" }]));
    sql.push(insert("league_round_events", [{ id: round.id, league_season_id: id(3), event_edition_id: round.eventEditionId,
      round_number: round.number, status: "completed" }]));
    for (const race of round.races) {
      const m = source.mappings.find((row) => row.raceId === race.id); const km = String(BigInt(race.distanceMetres) / 1000n);
      sql.push(insert("event_categories", [{ id: race.id, event_edition_id: round.eventEditionId, slug: `distance-${race.id.slice(-2)}`,
        name: "Synthetic race", distance_km: km, status: "completed" }]));
      sql.push(insert("track_templates", [{ id: m.trackTemplateId, organization_id: id(1), slug: `synthetic-${race.id}`, name: "Synthetic course" }]));
      sql.push(insert("track_versions", [{ id: race.trackVersionId, track_template_id: m.trackTemplateId, version_number: 1,
        gpx_storage_path: `synthetic-not-a-file/${race.id}.gpx`, distance_km: km }]));
      sql.push(insert("event_category_track_snapshots", [{ id: m.trackSnapshotId, event_category_id: race.id, track_template_id: m.trackTemplateId,
        track_version_id: race.trackVersionId, snapshot_name: "Synthetic course", distance_km: km }]));
      sql.push(insert("result_runs", [{ id: m.run.id, event_category_id: race.id, trigger_type: "manual", status: "succeeded",
        started_at: "2026-06-01T10:00:00Z", completed_at: m.run.completedAt }]));
      const rows = source.rows.filter((row) => row.raceId === race.id);
      sql.push(insert("registrations", rows.map((r) => ({ id: r.registrationId, event_category_id: race.id, athlete_profile_id: r.sourceAthleteId,
        represented_club_id: r.representedClubId, status: "confirmed", participation_status: r.participationStatus,
        result_status: "official", source: "direct", birth_year_snapshot: r.registrationBirthYear }))));
      sql.push(insert("result_rows", rows.map((r) => ({ id: r.id, result_run_id: m.run.id, registration_id: r.registrationId,
        athlete_profile_id: r.sourceAthleteId, event_category_id: race.id, result_status: "official", finish_time_ms: r.finishTimeMs,
        rank_overall: r.rankOverall, represented_club_id: r.representedClubId,
        club_points: r.clubPointsHundredths === null ? null : String(BigInt(r.clubPointsHundredths) / 100n) }))));
      sql.push(insert("result_publications", [{ id: m.publicationId, event_category_id: race.id, result_run_id: m.run.id,
        publication_state: "official", published_by_user_id: id(4), published_at: m.publication.publishedAt }]));
      sql.push(insert("league_round_race_mappings", [{ id: race.mappingId, league_round_event_id: round.id, league_competition_id: race.competitionId,
        event_category_id: race.id, current_result_publication_id: m.publicationId }]));
    }
  }
  sql.push("commit;"); return sql.join("\n");
}

export function correctionSql(roundNumber) {
  const f = calculationFixture("race", roundNumber); const m = f.source.mappings[0];
  const newRun = id(10000 + roundNumber); const newPublication = id(11000 + roundNumber);
  return `begin;
    insert into public.result_runs(id,event_category_id,trigger_type,status,started_at,completed_at)
      values (${literal(newRun)},${literal(m.raceId)},'manual','succeeded','2026-06-02T10:00:00Z','2026-06-02T11:00:00Z');
    insert into public.result_rows(id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,
      rank_overall,represented_club_id,club_points)
      select ('78000000-0000-4000-8000-' || lpad((right(id::text,12)::integer + 20000)::text,12,'0'))::uuid,
        ${literal(newRun)},registration_id,athlete_profile_id,event_category_id,'corrected',finish_time_ms,rank_overall,represented_club_id,club_points
      from public.result_rows where result_run_id = ${literal(m.run.id)};
    insert into public.result_publications(id,event_category_id,result_run_id,publication_state,published_by_user_id,published_at,supersedes_publication_id,change_note)
      values (${literal(newPublication)},${literal(m.raceId)},${literal(newRun)},'corrected',${literal(id(4))},'2026-06-02T12:00:00Z',
        ${literal(m.publicationId)},'Synthetic concurrency correction; no production result');
    update public.league_round_race_mappings set current_result_publication_id = ${literal(newPublication)} where id = ${literal(m.id)};
    commit;`;
}

export function recordFixtureSql() {
  const { priorSnapshot } = recordFixture(); const source = priorSnapshot.source;
  return ["begin;",
    `update public.event_categories set start_at='2026-06-01T10:00:00Z' where id=${literal(id(302))};`,
    insert("event_editions", [{ id: id(60000), event_series_id: id(11), slug: "synthetic-prior-year", name: "Synthetic previous-year race",
      start_date: "2025-06-01", status: "completed" }]),
    insert("event_categories", [{ id: id(60001), event_edition_id: id(60000), slug: "synthetic-prior-short", name: "Synthetic prior short",
      start_at: source.race.startAt, distance_km: "5", status: "completed" }]),
    insert("track_templates", [{ id: id(60002), organization_id: id(1), slug: "synthetic-prior-course", name: "Synthetic prior course" }]),
    insert("track_versions", [{ id: id(60003), track_template_id: id(60002), version_number: 1, gpx_storage_path: "synthetic-not-a-file/prior.gpx", distance_km: "5" }]),
    insert("event_category_track_snapshots", [{ id: id(60004), event_category_id: id(60001), track_template_id: id(60002),
      track_version_id: id(60003), snapshot_name: "Synthetic prior course", distance_km: "5" }]),
    insert("result_runs", [{ id: id(60005), event_category_id: id(60001), trigger_type: "manual", status: "succeeded",
      started_at: source.race.startAt, completed_at: source.run.completedAt }]),
    insert("registrations", source.rows.map((r) => ({ id: r.registrationId, event_category_id: id(60001), athlete_profile_id: r.sourceAthleteId,
      status: "confirmed", participation_status: r.participationStatus, result_status: "official", source: "direct" }))),
    insert("result_rows", source.rows.map((r) => ({ id: r.id, result_run_id: id(60005), registration_id: r.registrationId,
      athlete_profile_id: r.sourceAthleteId, event_category_id: id(60001), result_status: "official", finish_time_ms: r.finishTimeMs }))),
    insert("result_publications", [{ id: id(60006), event_category_id: id(60001), result_run_id: id(60005), publication_state: "official",
      published_by_user_id: id(4), published_at: source.publication.publishedAt }]), "commit;"].join("\n");
}

export function recordCorrectionSql(revision = 1) {
  if (![1, 2].includes(revision)) throw new Error("Unsupported synthetic record correction");
  const oldRun = id(60005 + (revision - 1) * 2); const newRun = id(60007 + (revision - 1) * 2);
  const oldPublication = id(60006 + (revision - 1) * 2); const newPublication = id(60008 + (revision - 1) * 2);
  return `begin;
    insert into public.result_runs(id,event_category_id,trigger_type,status,started_at,completed_at)
      values (${literal(newRun)},${literal(id(60001))},'manual','succeeded','2025-06-01T08:00:00Z','2025-06-01T09:00:00Z');
    insert into public.result_rows(id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms)
      select ('78000000-0000-4000-8000-' || lpad((right(id::text,12)::integer + 100)::text,12,'0'))::uuid,
        ${literal(newRun)},registration_id,athlete_profile_id,event_category_id,'corrected',
        case when id=${literal(id(60020 + (revision - 1) * 100))} then ${1800000 - revision * 100000} else finish_time_ms end
      from public.result_rows where result_run_id=${literal(oldRun)};
    insert into public.result_publications(id,event_category_id,result_run_id,publication_state,published_by_user_id,published_at,supersedes_publication_id,change_note)
      values (${literal(newPublication)},${literal(id(60001))},${literal(newRun)},'corrected',${literal(id(4))},
        '2026-06-0${revision + 1}T12:00:00.000001Z',${literal(oldPublication)},'Synthetic prior-record correction; no production data');
    commit;`;
}
