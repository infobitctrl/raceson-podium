import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { getPublicLeagueClassificationIds } from "./features/leagues/public-classification-eligibility.js";

export type CurrentPublishedResultFilter =
  | { athleteProfileIds: string[] }
  | { representedClubIds: string[] }
  | { eventCategoryIds: string[] };

export type CurrentPublishedResultPage = {
  rows: CurrentPublishedResultRow[];
  nextOffset: number | null;
};

export type PublicLeagueClubStandingDetails = {
  clubs: Array<{
    clubId: string;
    points: number;
    scoredRounds: number;
    rank: number | null;
    contributions: Array<{
      leagueRoundId: string;
      roundNumber: number;
      points: number;
      members: Array<{
        athleteProfileId: string;
        rank: number;
        points: number;
      }>;
    }>;
  }>;
};

export type CurrentPublishedResultRow = {
  leagueClassificationIds?: string[];
  publicationId: string;
  publicationState: "official" | "corrected";
  publishedAt: string;
  resultRowId: string;
  resultRunId: string;
  athleteProfileId: string;
  eventCategoryId: string;
  resultStatus: "official" | "corrected";
  participationStatus: string | null;
  bib: string | null;
  finishTimeMs: number | null;
  gapMs: number | null;
  rankOverall: number | null;
  rankGender: number | null;
  rankAgeCategory: number | null;
  clubPoints: number | null;
  representedClubId: string | null;
  resultCreatedAt: string;
};

type CurrentPublishedResultDatabaseRow = {
  publication_id: string;
  publication_state: "official" | "corrected";
  published_at: string;
  result_row_id: string;
  result_run_id: string;
  registration_id: string;
  athlete_profile_id: string;
  event_category_id: string;
  result_status: "official" | "corrected";
  finish_time_ms: number | null;
  gap_ms: number | null;
  rank_overall: number | null;
  rank_gender: number | null;
  rank_age_category: number | null;
  club_points: number | null;
  represented_club_id: string | null;
  result_created_at: string;
};

const MAX_PAGE_SIZE = 500;

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getCurrentPublishedResultPage(
  filter: CurrentPublishedResultFilter,
  offset = 0,
  pageSize = MAX_PAGE_SIZE,
  env: ServerEnv = loadServerEnv(),
  leagueSeasonId?: string,
): Promise<CurrentPublishedResultPage> {
  const adminClient = createAdminSupabaseClient(env);
  const boundedPageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(pageSize)));
  const boundedOffset = Math.max(0, Math.trunc(offset));

  let query = adminClient
    .from("public_current_published_result_rows")
    .select(
      "publication_id,publication_state,published_at,result_row_id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,gap_ms,rank_overall,rank_gender,rank_age_category,club_points,represented_club_id,result_created_at",
    );

  if ("athleteProfileIds" in filter) {
    query = query.in("athlete_profile_id", filter.athleteProfileIds);
  } else if ("representedClubIds" in filter) {
    query = query.in("represented_club_id", filter.representedClubIds);
  } else {
    query = query.in("event_category_id", filter.eventCategoryIds);
  }

  const { data, error } = await query
    .order("published_at", { ascending: false })
    .order("result_row_id", { ascending: true })
    .range(boundedOffset, boundedOffset + boundedPageSize);

  if (error) throw error;

  const databaseRows = (data ?? []) as CurrentPublishedResultDatabaseRow[];
  const pageRows = databaseRows.slice(0, boundedPageSize);
  const classificationIds = leagueSeasonId
    ? await getPublicLeagueClassificationIds(adminClient, leagueSeasonId, pageRows)
    : null;
  const registrationIds = Array.from(new Set(pageRows.map((row) => row.registration_id)));
  const [registrationResult, bibResult] = registrationIds.length
    ? await Promise.all([
        adminClient
          .from("registrations")
          .select("id,participation_status")
          .in("id", registrationIds)
          .returns<Array<{ id: string; participation_status: string | null }>>(),
        adminClient
          .from("bib_assignments")
          .select("registration_id,bib_number,assigned_at")
          .in("registration_id", registrationIds)
          .is("revoked_at", null)
          .order("assigned_at", { ascending: false })
          .returns<Array<{
            registration_id: string;
            bib_number: string | number | null;
            assigned_at: string;
          }>>(),
      ])
    : [
        { data: [] as Array<{ id: string; participation_status: string | null }>, error: null },
        { data: [] as Array<{
          registration_id: string;
          bib_number: string | number | null;
          assigned_at: string;
        }>, error: null },
      ];

  if (registrationResult.error) throw registrationResult.error;
  if (bibResult.error) throw bibResult.error;

  const participationStatusByRegistrationId = new Map(
    (registrationResult.data ?? []).map((registration) => [registration.id, registration.participation_status]),
  );
  const bibByRegistrationId = new Map<string, string | null>();
  for (const bib of bibResult.data ?? []) {
    if (!bibByRegistrationId.has(bib.registration_id)) {
      bibByRegistrationId.set(
        bib.registration_id,
        bib.bib_number == null ? null : String(bib.bib_number),
      );
    }
  }

  return {
    rows: pageRows.map((row) => ({
      ...(classificationIds ? { leagueClassificationIds: classificationIds.get(row.result_row_id) ?? [] } : {}),
      publicationId: row.publication_id,
      publicationState: row.publication_state,
      publishedAt: row.published_at,
      resultRowId: row.result_row_id,
      resultRunId: row.result_run_id,
      athleteProfileId: row.athlete_profile_id,
      eventCategoryId: row.event_category_id,
      resultStatus: row.result_status,
      participationStatus: participationStatusByRegistrationId.get(row.registration_id) ?? null,
      bib: bibByRegistrationId.get(row.registration_id) ?? null,
      finishTimeMs: finiteNumber(row.finish_time_ms),
      gapMs: finiteNumber(row.gap_ms),
      rankOverall: finiteNumber(row.rank_overall),
      rankGender: finiteNumber(row.rank_gender),
      rankAgeCategory: finiteNumber(row.rank_age_category),
      clubPoints: finiteNumber(row.club_points),
      representedClubId: row.represented_club_id,
      resultCreatedAt: row.result_created_at,
    })),
    nextOffset: databaseRows.length > boundedPageSize
      ? boundedOffset + boundedPageSize
      : null,
  };
}

export async function getPublicLeagueClubStandingDetails(
  leagueSeasonId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicLeagueClubStandingDetails> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("public_league_standings", {
    p_league_season_id: leagueSeasonId,
  });
  if (error) throw error;

  const payload = data && typeof data === "object"
    ? data as { clubs?: Array<{
        clubId: string;
        points: number;
        scoredRounds: number;
        rank: number | null;
        contributions?: PublicLeagueClubStandingDetails["clubs"][number]["contributions"];
      }> }
    : null;

  return {
    clubs: (payload?.clubs ?? []).map((club) => ({
      clubId: club.clubId,
      points: Number(club.points),
      scoredRounds: Math.trunc(Number(club.scoredRounds)),
      rank: club.rank == null ? null : Math.trunc(Number(club.rank)),
      contributions: (club.contributions ?? []).map((contribution) => ({
        leagueRoundId: contribution.leagueRoundId,
        roundNumber: Math.trunc(Number(contribution.roundNumber)),
        points: Number(contribution.points),
        members: (contribution.members ?? []).map((member) => ({
          athleteProfileId: member.athleteProfileId,
          rank: Math.trunc(Number(member.rank)),
          points: Number(member.points),
        })),
      })),
    })),
  };
}
