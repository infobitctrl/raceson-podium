import { randomUUID } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  requireEditionAccess,
  requireOrganizationAccess,
  resolveEditionContext,
  type PermissionRequirement,
} from "./permissions.js";
import {
  allocateCategoryBibs,
  freezeStartListManifest,
  getPreRaceReadiness,
  publishTimingPlan,
  recordPreRaceRehearsal,
} from "./pre-race.js";
import { createAdminSupabaseClient } from "./supabase.js";

const PRACTICE_CATEGORY_BLUEPRINTS = [
  {
    key: "short",
    name: "Test Short",
    slug: "practice-short",
    distanceKm: 6,
    elevationGainM: 250,
    bibStart: 101,
    seedRunnerCount: 5,
  },
  {
    key: "long",
    name: "Test Long",
    slug: "practice-long",
    distanceKm: 12,
    elevationGainM: 600,
    bibStart: 201,
    seedRunnerCount: 5,
  },
] as const;

const PRACTICE_CATEGORY_CAPACITY = 20;
const PRACTICE_RUNNER_LIMIT = 100;
const PRACTICE_BASELINE_RUNNER_COUNT = PRACTICE_CATEGORY_BLUEPRINTS.reduce(
  (total, category) => total + category.seedRunnerCount,
  0,
);
const LOCAL_DEMO_TIMER_EMAIL = "timer@sitrail.local";
const LOCAL_DEMO_TIMER_USERNAME = "demo-timer";
const LOCAL_DEMO_ACCESS_ENDS_AT = "2099-12-31T23:59:59.000Z";

type PracticeCategoryRow = {
  id: string;
  name: string;
  slug: string;
  display_order: number;
  practicePolicy?: PracticeCategoryPolicy;
};

type PracticeRegistrationRow = {
  id: string;
  event_category_id: string;
  participation_status: string;
  created_at?: string;
};

export type PracticeRaceState = {
  editionId: string;
  organizationId: string;
  name: string;
  isPractice: true;
  totalRunners: number;
  bibAssignedCount: number;
  checkedInCount: number;
  startedCategoryCount: number;
  finishPunchCount: number;
  finishedRunnerCount: number;
  timingReadinessState: "draft" | "planned" | "ready" | "failed";
  teamAssignmentCount: number;
  baselineRunnerCount: number;
  runnerLimit: number;
  categories: Array<{
    id: string;
    name: string;
    runnerCount: number;
    bibStart: number;
    bibEnd: number;
  }>;
};

type PracticeCategoryPolicy = {
  bibStart: number;
  seedRunnerCount: number;
};

function practiceCategoryPolicy(category: PracticeCategoryRow, index: number): PracticeCategoryPolicy {
  if (category.practicePolicy) return category.practicePolicy;
  const defaultBlueprint = PRACTICE_CATEGORY_BLUEPRINTS.find(
    (item) => item.slug === category.slug,
  );
  return defaultBlueprint ?? {
    bibStart: (index + 1) * 100 + 1,
    seedRunnerCount: 2,
  };
}

function practiceSlugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

async function getPracticeEditionForOrganization(
  organizationId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: series, error: seriesError } = await adminClient
    .from("event_series")
    .select("id")
    .eq("organization_id", organizationId)
    .returns<Array<{ id: string }>>();
  if (seriesError) throw seriesError;
  const seriesIds = (series ?? []).map((item) => item.id);
  if (!seriesIds.length) return null;

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id")
    .in("event_series_id", seriesIds)
    .eq("is_practice", true)
    .eq("slug", "practice-race")
    .is("organizer_deleted_at", null)
    .maybeSingle<{ id: string }>();
  if (editionError) throw editionError;
  return edition?.id ?? null;
}

async function practiceRaceBaselineIsComplete(
  editionId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const categories = await listPracticeCategories(editionId, env);
  const expectedCategorySlugs = new Set<string>(
    PRACTICE_CATEGORY_BLUEPRINTS.map((category) => category.slug),
  );
  if (
    categories.length !== PRACTICE_CATEGORY_BLUEPRINTS.length
    || categories.some((category) => !expectedCategorySlugs.has(category.slug))
  ) {
    return false;
  }
  const categoryIds = categories.map((category) => category.id);
  const [registrationResult, snapshotResult, checkpointResult] = await Promise.all([
    adminClient
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds)
      .in("status", ["draft", "pending", "confirmed", "waitlisted"]),
    adminClient
      .from("event_category_track_snapshots")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds),
    adminClient
      .from("checkpoints")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds),
  ]);
  if (registrationResult.error) throw registrationResult.error;
  if (snapshotResult.error) throw snapshotResult.error;
  if (checkpointResult.error) throw checkpointResult.error;
  const registrationCount = registrationResult.count ?? 0;
  return (
    registrationCount >= PRACTICE_BASELINE_RUNNER_COUNT
    && registrationCount <= PRACTICE_RUNNER_LIMIT
    && snapshotResult.count === PRACTICE_CATEGORY_BLUEPRINTS.length
    && checkpointResult.count === PRACTICE_CATEGORY_BLUEPRINTS.length * 3
  );
}

async function ensureLocalDemoTimerAssignment(
  session: RequestSession,
  organizationId: string,
  editionId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: demoTimer, error: timerError } = await adminClient
    .from("user_profiles")
    .select("user_id,display_name")
    .eq("email", LOCAL_DEMO_TIMER_EMAIL)
    .maybeSingle<{ user_id: string; display_name: string }>();
  if (timerError) throw timerError;
  if (!demoTimer) return;

  const { data: membership, error: membershipError } = await adminClient
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", demoTimer.user_id)
    .neq("status", "removed")
    .maybeSingle<{ id: string }>();
  if (membershipError) throw membershipError;
  if (!membership) return;

  const { error: membershipUpdateError } = await adminClient
    .from("organization_memberships")
    .update({
      role: "timer",
      status: "active",
      membership_type: "temporary",
      account_template_key: "checkpoint-timer",
      permission_keys: ["checkpoint_timing.enter"],
      login_username: LOCAL_DEMO_TIMER_USERNAME,
      expires_at: LOCAL_DEMO_ACCESS_ENDS_AT,
    })
    .eq("id", membership.id);
  if (membershipUpdateError) throw membershipUpdateError;

  const categories = await listPracticeCategories(editionId, env);
  const categoryIds = categories.map((category) => category.id);
  if (!categoryIds.length) return;

  const { data: checkpoint, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("id,event_category_id")
    .in("event_category_id", categoryIds)
    .eq("checkpoint_type", "split")
    .order("sequence_number", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; event_category_id: string }>();
  if (checkpointError) throw checkpointError;
  if (!checkpoint) return;

  const { data: existingAssignment, error: assignmentLookupError } = await adminClient
    .from("event_staff_assignments")
    .select("id")
    .eq("event_edition_id", editionId)
    .eq("staff_user_id", demoTimer.user_id)
    .in("assignment_state", ["planned", "confirmed", "checked_in"])
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (assignmentLookupError) throw assignmentLookupError;
  if (existingAssignment) return;

  const { error: assignmentError } = await adminClient
    .from("event_staff_assignments")
    .insert({
      event_edition_id: editionId,
      event_category_id: checkpoint.event_category_id,
      checkpoint_id: checkpoint.id,
      staff_user_id: demoTimer.user_id,
      display_name: demoTimer.display_name || "Demo Timer",
      worker_type: "staff",
      role_code: "checkpoint_timer",
      role_title: "Checkpoint Timer",
      access_scope: "timing",
      permission_keys: ["checkpoint_timing.enter"],
      assignment_state: "confirmed",
      starts_at: new Date().toISOString(),
      ends_at: LOCAL_DEMO_ACCESS_ENDS_AT,
      briefing_required: false,
      instructions: "Test Race checkpoint timing.",
      client_event_id: crypto.randomUUID(),
      created_by_user_id: session.account.userId,
    });
  if (assignmentError) throw assignmentError;
}

async function requirePracticeEdition(
  session: RequestSession,
  editionId: string,
  requirement: PermissionRequirement,
  env: ServerEnv,
) {
  const edition = await requireEditionAccess(session, editionId, requirement, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_editions")
    .select("id,is_practice")
    .eq("id", editionId)
    .maybeSingle<{ id: string; is_practice: boolean }>();
  if (error) throw error;
  if (!data?.is_practice) throw conflict("Only the private Test Race can use this action");
  return edition;
}

async function listPracticeCategories(editionId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_categories")
    .select("id,name,slug,display_order")
    .eq("event_edition_id", editionId)
    .order("display_order", { ascending: true })
    .returns<PracticeCategoryRow[]>();
  if (error) throw error;
  const { data: edition, error: editionError } = await adminClient
    .from("event_editions").select("general_timeline_json").eq("id", editionId)
    .maybeSingle<{ general_timeline_json: { practiceCategoryPolicies?: Record<string, PracticeCategoryPolicy> } }>();
  if (editionError) throw editionError;
  const policies = edition?.general_timeline_json?.practiceCategoryPolicies;
  return (data ?? []).map((category) => ({ ...category, practicePolicy: policies?.[category.slug] }));
}

// PostgREST limits each response. Never silently truncate a cloned start list.
async function readPracticeRegistrations<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const page = await query(from, from + 499);
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 500) return rows;
  }
}

async function preparePracticeTiming(
  session: RequestSession,
  editionId: string,
  env: ServerEnv,
) {
  const readiness = await getPreRaceReadiness(session, editionId, env);
  if (readiness.startList.state !== "frozen") {
    await freezeStartListManifest(
      session,
      editionId,
      "Test Race ready baseline",
      env,
    );
  }

  const categories = await listPracticeCategories(editionId, env);
  const adminClient = createAdminSupabaseClient(env);
  const categoryIds = categories.map((category) => category.id);
  const { data: checkpoints, error } = categoryIds.length
    ? await adminClient
        .from("checkpoints")
        .select("id,event_category_id,name,sequence_number")
        .in("event_category_id", categoryIds)
        .order("sequence_number", { ascending: true })
        .returns<Array<{
          id: string;
          event_category_id: string;
          name: string;
          sequence_number: number;
        }>>()
    : {
        data: [] as Array<{
          id: string;
          event_category_id: string;
          name: string;
          sequence_number: number;
        }>,
        error: null,
      };
  if (error) throw error;

  const latestReadiness = await getPreRaceReadiness(session, editionId, env);
  if (!latestReadiness.timing.currentPlan) {
    await publishTimingPlan(
      session,
      editionId,
      {
        name: "Test Race manual timing plan",
        clockToleranceMs: 2_000,
        points: (checkpoints ?? []).map((checkpoint) => ({
          categoryId: checkpoint.event_category_id,
          checkpointId: checkpoint.id,
          captureMode: "manual" as const,
          backupMethod: "Manual paper backup",
          operatorLabel:
            `${categories.find((category) => category.id === checkpoint.event_category_id)?.name ?? "Test"} · ${checkpoint.name}`,
        })),
      },
      env,
    );
  }

  const finalReadiness = await getPreRaceReadiness(session, editionId, env);
  if (finalReadiness.timing.state !== "ready") {
    await recordPreRaceRehearsal(
      session,
      editionId,
      {
        passed: true,
        checklist: {
          manifestVerified: true,
          clockSyncVerified: true,
          backupCaptureVerified: true,
          operatorBriefingComplete: true,
          testPunchReconciled: true,
        },
        issues: [],
        notes: "Automatically prepared for Test Race.",
      },
      env,
    );
  }
}

async function clonePracticeRaceFromEdition(
  session: RequestSession,
  organizationId: string,
  sourceEditionId: string,
  env: ServerEnv,
): Promise<PracticeRaceState> {
  const sourceContext = await requireEditionAccess(
    session,
    sourceEditionId,
    "events.manage",
    env,
  );
  if (sourceContext.organizationId !== organizationId) {
    throw conflict("The source race must belong to the selected organization");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: sourceEdition, error: sourceEditionError } = await adminClient
    .from("event_editions")
    .select("id,event_series_id,name,timezone,location_name,is_practice")
    .eq("id", sourceEditionId)
    .maybeSingle<{
      id: string;
      event_series_id: string;
      name: string;
      timezone: string;
      location_name: string | null;
      is_practice: boolean;
    }>();
  if (sourceEditionError) throw sourceEditionError;
  if (!sourceEdition) throw notFound("Source race not found");
  if (sourceEdition.is_practice) {
    throw conflict("Choose a real race as the sandbox template");
  }

  const { data: sourceCategories, error: sourceCategoryError } = await adminClient
    .from("event_categories")
    .select("id,slug,name,distance_km,elevation_gain_m,currency,minimum_age,maximum_age,allowed_genders,eligibility_note,parking_label,organizer_notes,display_order,results_mode,ranking_config_json")
    .eq("event_edition_id", sourceEditionId)
    .is("organizer_deleted_at", null)
    .order("display_order", { ascending: true })
    .returns<Array<{
      id: string;
      slug: string;
      name: string;
      distance_km: string | number | null;
      elevation_gain_m: number | null;
      currency: string | null;
      minimum_age: number | null;
      maximum_age: number | null;
      allowed_genders: Array<"F" | "M" | "U">;
      eligibility_note: string | null;
      parking_label: string | null;
      organizer_notes: string | null;
      display_order: number | null;
      results_mode: string;
      ranking_config_json: unknown;
    }>>();
  if (sourceCategoryError) throw sourceCategoryError;
  if (!sourceCategories?.length) {
    throw conflict("Add at least one race to the source race before cloning it");
  }
  if (sourceCategories.length > 50) {
    throw conflict("A sandbox can contain at most 50 races");
  }

  const sourceCategoryIds = sourceCategories.map((category) => category.id);
  // Copy registration coverage only. Each entry gets a new anonymous practice identity.
  const sourceRegistrations = await readPracticeRegistrations((from, to) => adminClient
    .from("registrations").select("id,event_category_id")
    .in("event_category_id", sourceCategoryIds).is("organizer_removed_at", null)
    .order("id", { ascending: true }).range(from, to)
    .returns<Array<{ id: string; event_category_id: string }>>());
  let nextBib = 101;
  const practiceCategoryPolicies = Object.fromEntries(sourceCategories.map((category) => {
    const seedRunnerCount = sourceRegistrations.filter((row) => row.event_category_id === category.id).length;
    const policy = { seedRunnerCount, bibStart: nextBib };
    nextBib += Math.max(PRACTICE_CATEGORY_CAPACITY, seedRunnerCount) + 100;
    return [category.slug, policy];
  }));
  const [sourceSnapshotsResult, sourceCheckpointsResult] = await Promise.all([
    adminClient
      .from("event_category_track_snapshots")
      .select("id,event_category_id,track_template_id,track_version_id,snapshot_name,snapshot_gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,snapshot_json")
      .in("event_category_id", sourceCategoryIds)
      .returns<Array<{
        id: string;
        event_category_id: string;
        track_template_id: string;
        track_version_id: string;
        snapshot_name: string;
        snapshot_gpx_storage_path: string | null;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
        snapshot_json: unknown;
      }>>(),
    adminClient
      .from("checkpoints")
      .select("event_category_id,code,name,checkpoint_type,sequence_number,distance_from_start_km,is_mandatory,settings_json")
      .in("event_category_id", sourceCategoryIds)
      .order("sequence_number", { ascending: true })
      .returns<Array<{
        event_category_id: string;
        code: string;
        name: string;
        checkpoint_type: string;
        sequence_number: number;
        distance_from_start_km: string | number | null;
        is_mandatory: boolean;
        settings_json: unknown;
      }>>(),
  ]);
  if (sourceSnapshotsResult.error) throw sourceSnapshotsResult.error;
  if (sourceCheckpointsResult.error) throw sourceCheckpointsResult.error;

  const cloneToken = randomUUID().replaceAll("-", "");
  const date = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const seriesSlug = `sandbox-${sourceEditionId.replaceAll("-", "").slice(0, 20)}`;
  const { data: sandboxSeries, error: seriesError } = await adminClient
    .from("event_series")
    .upsert({
      organization_id: organizationId,
      name: `${sourceEdition.name} Sandbox`,
      slug: seriesSlug,
      description: `Private testing clone of ${sourceEdition.name}.`,
      status: "active",
      country_code: "HR",
      location_name: sourceEdition.location_name,
      updated_at: now,
    }, { onConflict: "organization_id,slug" })
    .select("id")
    .single<{ id: string }>();
  if (seriesError) throw seriesError;

  const { data: sandboxEdition, error: editionError } = await adminClient
    .from("event_editions")
    .insert({
      event_series_id: sandboxSeries.id,
      name: `${sourceEdition.name} · Sandbox`,
      slug: `sandbox-${cloneToken.slice(0, 12)}`,
      status: "draft",
      start_date: date,
      end_date: date,
      timezone: sourceEdition.timezone,
      location_name: sourceEdition.location_name,
      about_text: `Private sandbox cloned from ${sourceEdition.name}. Registrations were copied as anonymous test runners; real identities and results were not copied.`,
      public_visibility: "private",
      results_visibility: "private",
      is_practice: true,
      general_timeline_json: {
        sandbox: true,
        sourceEditionId,
        practiceCategoryPolicies,
      },
      updated_at: now,
    })
    .select("id")
    .single<{ id: string }>();
  if (editionError) throw editionError;

  const { data: sandboxCategories, error: categoryError } = await adminClient
    .from("event_categories")
    .insert(sourceCategories.map((category, index) => ({
      event_edition_id: sandboxEdition.id,
      slug: category.slug,
      name: category.name,
      distance_km: category.distance_km,
      elevation_gain_m: category.elevation_gain_m,
      capacity: Math.max(PRACTICE_CATEGORY_CAPACITY, practiceCategoryPolicies[category.slug].seedRunnerCount),
      registration_fee_cents: 0,
      currency: category.currency ?? "EUR",
      minimum_age: category.minimum_age,
      maximum_age: category.maximum_age,
      allowed_genders: category.allowed_genders,
      eligibility_note: category.eligibility_note,
      start_at: now,
      parking_label: category.parking_label,
      organizer_notes: category.organizer_notes,
      display_order: category.display_order ?? index,
      results_mode: category.results_mode,
      ranking_config_json: category.ranking_config_json,
      status: "published",
    })))
    .select("id,slug,name,display_order")
    .returns<PracticeCategoryRow[]>();
  if (categoryError) throw categoryError;

  const sourceCategoryBySlug = new Map(sourceCategories.map((category) => [category.slug, category]));
  const sandboxCategoryBySourceId = new Map<string, PracticeCategoryRow>();
  for (const category of sandboxCategories ?? []) {
    const sourceCategory = sourceCategoryBySlug.get(category.slug);
    if (sourceCategory) sandboxCategoryBySourceId.set(sourceCategory.id, category);
  }

  const snapshotBySourceCategory = new Map(
    (sourceSnapshotsResult.data ?? []).map((snapshot) => [snapshot.event_category_id, snapshot]),
  );
  const needsFallbackTrack = sourceCategories.some(
    (category) => !snapshotBySourceCategory.has(category.id),
  );
  let fallbackTrack: { templateId: string; versionId: string } | null = null;
  if (needsFallbackTrack) {
    const { data: template, error: templateError } = await adminClient
      .from("track_templates")
      .upsert({
        organization_id: organizationId,
        name: "Sandbox fallback route",
        slug: "sitrail-sandbox-fallback-route",
        terrain_type: "training",
        notes: "Private synthetic route for sandbox races without a configured route.",
        updated_at: now,
      }, { onConflict: "organization_id,slug" })
      .select("id")
      .single<{ id: string }>();
    if (templateError) throw templateError;
    const { data: version, error: versionError } = await adminClient
      .from("track_versions")
      .upsert({
        track_template_id: template.id,
        version_number: 1,
        gpx_storage_path: `practice/${organizationId}/sandbox-fallback.gpx`,
        distance_km: 10,
        elevation_gain_m: 300,
        elevation_loss_m: 300,
        start_lat: 45.815,
        start_lng: 15.982,
        finish_lat: 45.815,
        finish_lng: 15.982,
      }, { onConflict: "track_template_id,version_number" })
      .select("id")
      .single<{ id: string }>();
    if (versionError) throw versionError;
    fallbackTrack = { templateId: template.id, versionId: version.id };
  }

  const snapshotRows = sourceCategories.map((sourceCategory) => {
    const sandboxCategory = sandboxCategoryBySourceId.get(sourceCategory.id);
    if (!sandboxCategory) throw new Error(`Missing sandbox race ${sourceCategory.name}`);
    const sourceSnapshot = snapshotBySourceCategory.get(sourceCategory.id);
    const distanceKm = sourceSnapshot?.distance_km ?? sourceCategory.distance_km ?? 10;
    return {
      event_category_id: sandboxCategory.id,
      track_template_id: sourceSnapshot?.track_template_id ?? fallbackTrack?.templateId,
      track_version_id: sourceSnapshot?.track_version_id ?? fallbackTrack?.versionId,
      snapshot_name: `${sourceSnapshot?.snapshot_name ?? sourceCategory.name} · Sandbox`,
      snapshot_gpx_storage_path: sourceSnapshot?.snapshot_gpx_storage_path
        ?? `practice/${organizationId}/sandbox-fallback.gpx`,
      distance_km: distanceKm,
      elevation_gain_m: sourceSnapshot?.elevation_gain_m ?? sourceCategory.elevation_gain_m ?? 300,
      elevation_loss_m: sourceSnapshot?.elevation_loss_m ?? sourceCategory.elevation_gain_m ?? 300,
      snapshot_json: sourceSnapshot?.snapshot_json ?? {
        practice: true,
        routePoints: [
          { lat: 45.815, lng: 15.982 },
          { lat: 45.825, lng: 15.995 },
          { lat: 45.815, lng: 15.982 },
        ],
      },
    };
  });
  const { data: sandboxSnapshots, error: snapshotError } = await adminClient
    .from("event_category_track_snapshots")
    .insert(snapshotRows)
    .select("id,event_category_id")
    .returns<Array<{ id: string; event_category_id: string }>>();
  if (snapshotError) throw snapshotError;
  const snapshotBySandboxCategory = new Map(
    (sandboxSnapshots ?? []).map((snapshot) => [snapshot.event_category_id, snapshot.id]),
  );

  const checkpointRows = sourceCategories.flatMap((sourceCategory) => {
    const sandboxCategory = sandboxCategoryBySourceId.get(sourceCategory.id);
    if (!sandboxCategory) throw new Error(`Missing sandbox race ${sourceCategory.name}`);
    const snapshotId = snapshotBySandboxCategory.get(sandboxCategory.id);
    if (!snapshotId) throw new Error(`Missing sandbox route ${sourceCategory.name}`);
    const sourceCheckpoints = (sourceCheckpointsResult.data ?? []).filter(
      (checkpoint) => checkpoint.event_category_id === sourceCategory.id,
    );
    if (sourceCheckpoints.length) {
      return sourceCheckpoints.map((checkpoint) => ({
        event_category_id: sandboxCategory.id,
        track_snapshot_id: snapshotId,
        code: checkpoint.code,
        name: checkpoint.name,
        checkpoint_type: checkpoint.checkpoint_type,
        sequence_number: checkpoint.sequence_number,
        distance_from_start_km: checkpoint.distance_from_start_km,
        cutoff_at: null,
        is_mandatory: checkpoint.is_mandatory,
        settings_json: checkpoint.settings_json,
      }));
    }
    const distanceKm = Number(sourceCategory.distance_km ?? 10);
    return [
      { event_category_id: sandboxCategory.id, track_snapshot_id: snapshotId, code: "START", name: "Start", checkpoint_type: "start", sequence_number: 1, distance_from_start_km: 0, cutoff_at: null, is_mandatory: true, settings_json: { isTimingSplit: true, visibleOnPublicPage: false } },
      { event_category_id: sandboxCategory.id, track_snapshot_id: snapshotId, code: "CP1", name: "Control Point 1", checkpoint_type: "split", sequence_number: 2, distance_from_start_km: distanceKm / 2, cutoff_at: null, is_mandatory: true, settings_json: { isTimingSplit: true, visibleOnPublicPage: false } },
      { event_category_id: sandboxCategory.id, track_snapshot_id: snapshotId, code: "FINISH", name: "Finish", checkpoint_type: "finish", sequence_number: 3, distance_from_start_km: distanceKm, cutoff_at: null, is_mandatory: true, settings_json: { isTimingSplit: true, visibleOnPublicPage: false } },
    ];
  });
  const { error: checkpointError } = await adminClient.from("checkpoints").insert(checkpointRows);
  if (checkpointError) throw checkpointError;

  const athleteRows = (sandboxCategories ?? []).flatMap((category, categoryIndex) =>
    Array.from({ length: practiceCategoryPolicies[category.slug].seedRunnerCount }, (_, runnerIndex) => ({
      slug: `sandbox-${cloneToken.slice(0, 12)}-${categoryIndex + 1}-${runnerIndex + 1}`,
      display_name: `Sandbox Runner ${categoryIndex + 1}.${runnerIndex + 1}`,
      first_name: "Sandbox",
      last_name: `Runner ${categoryIndex + 1}.${runnerIndex + 1}`,
      gender: runnerIndex % 2 ? "M" : "F",
      date_of_birth: `${1988 + (runnerIndex % 20)}-01-15`,
      country_code: "HR",
      city: "Sandbox",
      status: "practice",
      is_claimed: false,
      categoryId: category.id,
    })),
  );
  for (let offset = 0; offset < athleteRows.length; offset += 500) {
    const batch = athleteRows.slice(offset, offset + 500);
    const { data: athletes, error: athleteError } = await adminClient
      .from("athlete_profiles")
      .insert(batch.map(({ categoryId: _categoryId, ...athlete }) => athlete))
      .select("id,slug").returns<Array<{ id: string; slug: string }>>();
    if (athleteError) throw athleteError;
    const athleteBySlug = new Map((athletes ?? []).map((athlete) => [athlete.slug, athlete.id]));
    const registrationRows = batch.map((athlete) => {
      const athleteProfileId = athleteBySlug.get(athlete.slug);
      if (!athleteProfileId) throw new Error(`Missing ${athlete.display_name}`);
      return {
        athlete_profile_id: athleteProfileId,
        event_category_id: athlete.categoryId,
        status: "confirmed",
        payment_status: "not_required",
        participation_status: "not_started",
        result_status: "uncomputed",
        source: "practice",
        consent_basis: "athlete_accepted",
        confirmed_at: now,
        public_start_list_opt_in: false,
      };
    });
    const { error } = await adminClient.from("registrations").insert(registrationRows);
    if (error) throw error;
  }

  await ensureLocalDemoTimerAssignment(session, organizationId, sandboxEdition.id, env);
  return getPracticeRaceState(session, sandboxEdition.id, env);
}

export async function createPracticeRace(
  session: RequestSession,
  organizationId: string,
  input: { sourceEditionId?: string | null } = {},
  env: ServerEnv = loadServerEnv(),
): Promise<PracticeRaceState> {
  requireOrganizationAccess(session, organizationId, "events.manage");
  if (input.sourceEditionId) {
    return clonePracticeRaceFromEdition(
      session,
      organizationId,
      input.sourceEditionId,
      env,
    );
  }
  const existingEditionId = await getPracticeEditionForOrganization(organizationId, env);
  if (
    existingEditionId
    && await practiceRaceBaselineIsComplete(existingEditionId, env)
  ) {
    await ensureLocalDemoTimerAssignment(
      session,
      organizationId,
      existingEditionId,
      env,
    );
    return getPracticeRaceState(session, existingEditionId, env);
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .select("id,name,slug")
    .eq("id", organizationId)
    .maybeSingle<{ id: string; name: string; slug: string }>();
  if (organizationError) throw organizationError;
  if (!organization) throw notFound("Organization not found");

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const startAt = now.toISOString();
  const organizationSlug = practiceSlugPart(organization.slug || organization.name || organizationId);
  const { count: deletedPracticeCount, error: deletedCountError } = await adminClient
    .from("event_editions").select("id,event_series!inner(organization_id)", { count: "exact", head: true })
    .eq("event_series.organization_id", organizationId).eq("is_practice", true)
    .eq("slug", "practice-race").not("organizer_deleted_at", "is", null);
  if (deletedCountError) throw deletedCountError;
  const seriesSlug = `sitrail-practice-${organizationSlug || organizationId.slice(0, 8)}${deletedPracticeCount ? `-${deletedPracticeCount}` : ""}`;
  const athleteSlugPrefix = `practice-${organizationId.replaceAll("-", "").slice(0, 8)}`;
  try {
    const { data: series, error: seriesError } = await adminClient
      .from("event_series")
      .upsert({
        organization_id: organizationId,
        name: "RacesOn Test Race",
        slug: seriesSlug,
        description: "Private Test Race for organizers and timing crews.",
        status: "active",
        country_code: "HR",
        location_name: "Test route",
        updated_at: now.toISOString(),
      }, {
        onConflict: "organization_id,slug",
      })
      .select("id")
      .single<{ id: string }>();
    if (seriesError) throw seriesError;

    const { data: edition, error: editionError } = await adminClient
      .from("event_editions")
      .upsert({
        event_series_id: series.id,
        name: "Test Race",
        slug: "practice-race",
        status: "draft",
        start_date: date,
        end_date: date,
        timezone: "Europe/Zagreb",
        location_name: "Test route",
        about_text: "Permanent private Test Race. Reset it whenever the team needs a fresh run.",
        public_visibility: "private",
        results_visibility: "private",
        is_practice: true,
        updated_at: now.toISOString(),
      }, {
        onConflict: "event_series_id,slug",
      })
      .select("id")
      .single<{ id: string }>();
    if (editionError) throw editionError;

    const { data: trackTemplate, error: trackTemplateError } = await adminClient
      .from("track_templates")
      .upsert({
        organization_id: organizationId,
        name: "RacesOn Test Route",
        slug: "sitrail-practice-route",
        terrain_type: "training",
        notes: "Private synthetic route used only by Test Race.",
        updated_at: now.toISOString(),
      }, {
        onConflict: "organization_id,slug",
      })
      .select("id")
      .single<{ id: string }>();
    if (trackTemplateError) throw trackTemplateError;

    const { data: trackVersion, error: trackVersionError } = await adminClient
      .from("track_versions")
      .upsert({
        track_template_id: trackTemplate.id,
        version_number: 1,
        distance_km: 12,
        elevation_gain_m: 600,
        elevation_loss_m: 600,
        start_lat: 45.815,
        start_lng: 15.982,
        finish_lat: 45.815,
        finish_lng: 15.982,
        gpx_storage_path: `practice/${organizationId}/practice-route.gpx`,
      }, {
        onConflict: "track_template_id,version_number",
      })
      .select("id")
      .single<{ id: string }>();
    if (trackVersionError) throw trackVersionError;

    const { data: categories, error: categoryError } = await adminClient
      .from("event_categories")
      .upsert(
        PRACTICE_CATEGORY_BLUEPRINTS.map((category, index) => ({
          event_edition_id: edition.id,
          name: category.name,
          slug: category.slug,
          status: "published",
          capacity: PRACTICE_CATEGORY_CAPACITY,
          currency: "EUR",
          start_at: startAt,
          distance_km: category.distanceKm,
          elevation_gain_m: category.elevationGainM,
          display_order: index,
          results_mode: "standard",
          allowed_genders: ["F", "M", "U"],
          organizer_notes: "Private test category with five synthetic runners.",
        })),
        {
          onConflict: "event_edition_id,slug",
        },
      )
      .select("id,name,slug,display_order")
      .returns<PracticeCategoryRow[]>();
    if (categoryError) throw categoryError;
    if ((categories ?? []).length !== PRACTICE_CATEGORY_BLUEPRINTS.length) {
      throw new Error("Test categories were not created");
    }

    const categoryBySlug = new Map((categories ?? []).map((category) => [category.slug, category]));
    const snapshotRows = PRACTICE_CATEGORY_BLUEPRINTS.map((blueprint) => {
      const category = categoryBySlug.get(blueprint.slug);
      if (!category) throw new Error(`Missing ${blueprint.name}`);
      return {
        event_category_id: category.id,
        track_template_id: trackTemplate.id,
        track_version_id: trackVersion.id,
        snapshot_name: `${blueprint.name} test route`,
        snapshot_gpx_storage_path: `practice/${organizationId}/${blueprint.key}.gpx`,
        distance_km: blueprint.distanceKm,
        elevation_gain_m: blueprint.elevationGainM,
        elevation_loss_m: blueprint.elevationGainM,
        snapshot_json: {
          practice: true,
          routePoints: [
            { lat: 45.815, lng: 15.982 },
            { lat: 45.825, lng: 15.995 },
            { lat: 45.815, lng: 15.982 },
          ],
        },
      };
    });
    const { data: snapshots, error: snapshotError } = await adminClient
      .from("event_category_track_snapshots")
      .upsert(snapshotRows, {
        onConflict: "event_category_id",
      })
      .select("id,event_category_id")
      .returns<Array<{ id: string; event_category_id: string }>>();
    if (snapshotError) throw snapshotError;
    const snapshotByCategory = new Map(
      (snapshots ?? []).map((snapshot) => [snapshot.event_category_id, snapshot.id]),
    );

    const checkpointRows = PRACTICE_CATEGORY_BLUEPRINTS.flatMap((blueprint) => {
      const category = categoryBySlug.get(blueprint.slug);
      if (!category) throw new Error(`Missing ${blueprint.name}`);
      const snapshotId = snapshotByCategory.get(category.id);
      if (!snapshotId) throw new Error(`Missing ${blueprint.name} route snapshot`);
      return [
        {
          event_category_id: category.id,
          track_snapshot_id: snapshotId,
          code: "START",
          name: "Start",
          checkpoint_type: "start",
          sequence_number: 1,
          distance_from_start_km: 0,
          is_mandatory: true,
          settings_json: {
            kind: "checkpoint",
            isTimingSplit: true,
            isWaterPoint: false,
            medicalAccess: false,
            visibleOnPublicPage: false,
            volunteerNote: "Test start desk",
            athleteNote: null,
          },
        },
        {
          event_category_id: category.id,
          track_snapshot_id: snapshotId,
          code: "CP1",
          name: "Control Point 1",
          checkpoint_type: "split",
          sequence_number: 2,
          distance_from_start_km: blueprint.distanceKm / 2,
          is_mandatory: true,
          settings_json: {
            kind: "timing_split",
            isTimingSplit: true,
            isWaterPoint: true,
            medicalAccess: false,
            visibleOnPublicPage: false,
            volunteerNote: "Test checkpoint timer",
            athleteNote: null,
          },
        },
        {
          event_category_id: category.id,
          track_snapshot_id: snapshotId,
          code: "FINISH",
          name: "Finish",
          checkpoint_type: "finish",
          sequence_number: 3,
          distance_from_start_km: blueprint.distanceKm,
          is_mandatory: true,
          settings_json: {
            kind: "checkpoint",
            isTimingSplit: true,
            isWaterPoint: false,
            medicalAccess: true,
            visibleOnPublicPage: false,
            volunteerNote: "Test finish desk",
            athleteNote: null,
          },
        },
      ];
    });
    const { error: checkpointError } = await adminClient
      .from("checkpoints")
      .upsert(checkpointRows, {
        onConflict: "event_category_id,code",
      });
    if (checkpointError) throw checkpointError;

    const athleteRows = PRACTICE_CATEGORY_BLUEPRINTS.flatMap((category) =>
      Array.from({ length: category.seedRunnerCount }, (_, runnerIndex) => {
        const runnerNumber = runnerIndex + 1;
        const categoryCode = category.key === "short" ? "S" : "L";
        return {
          slug: `${athleteSlugPrefix}-${category.key}-${runnerNumber}`,
          display_name: `Test Runner ${categoryCode}${runnerNumber}`,
          first_name: "Test",
          last_name: `${category.name.replace("Test ", "")} ${runnerNumber}`,
          gender: runnerIndex % 3 === 1 ? "M" : "F",
          date_of_birth: `${1985 + runnerIndex}-01-15`,
          country_code: "HR",
          city: "Test route",
          status: "practice",
          is_claimed: false,
        };
      }),
    );
    const { data: athletes, error: athleteError } = await adminClient
      .from("athlete_profiles")
      .upsert(athleteRows, {
        onConflict: "slug",
      })
      .select("id,slug")
      .returns<Array<{ id: string; slug: string }>>();
    if (athleteError) throw athleteError;
    const athleteBySlug = new Map((athletes ?? []).map((athlete) => [athlete.slug, athlete.id]));

    const registrationRows = PRACTICE_CATEGORY_BLUEPRINTS.flatMap((category) => {
      const eventCategory = categoryBySlug.get(category.slug);
      if (!eventCategory) throw new Error(`Missing ${category.name}`);
      return Array.from({ length: category.seedRunnerCount }, (_, runnerIndex) => {
        const runnerNumber = runnerIndex + 1;
        const athleteId = athleteBySlug.get(`${athleteSlugPrefix}-${category.key}-${runnerNumber}`);
        if (!athleteId) throw new Error(`Missing ${category.name} runner ${runnerNumber}`);
        return {
          athlete_profile_id: athleteId,
          event_category_id: eventCategory.id,
          status: "confirmed",
          payment_status: "not_required",
          participation_status: "not_started",
          result_status: "uncomputed",
          source: "practice",
          consent_basis: "athlete_accepted",
          confirmed_at: startAt,
          public_start_list_opt_in: false,
        };
      });
    });
    const categoryIds = (categories ?? []).map((category) => category.id);
    const { data: existingRegistrations, error: existingRegistrationError } =
      await adminClient
        .from("registrations")
        .select("id,event_category_id,athlete_profile_id")
        .in("event_category_id", categoryIds)
        .in("status", ["draft", "pending", "confirmed", "waitlisted"])
        .returns<Array<{
          id: string;
          event_category_id: string;
          athlete_profile_id: string;
        }>>();
    if (existingRegistrationError) throw existingRegistrationError;
    const existingRegistrationKeys = new Set(
      (existingRegistrations ?? []).map(
        (registration) =>
          `${registration.event_category_id}:${registration.athlete_profile_id}`,
      ),
    );
    const missingRegistrationRows = registrationRows.filter(
      (registration) =>
        !existingRegistrationKeys.has(
          `${registration.event_category_id}:${registration.athlete_profile_id}`,
        ),
    );
    if (missingRegistrationRows.length) {
      const { error: registrationError } = await adminClient
        .from("registrations")
        .insert(missingRegistrationRows);
      if (registrationError) throw registrationError;
    }
    const baselineRegistrationKeys = new Set(
      registrationRows.map((registration) =>
        `${registration.event_category_id}:${registration.athlete_profile_id}`
      ),
    );
    const extraRegistrationIds = (existingRegistrations ?? []).flatMap((registration) =>
      baselineRegistrationKeys.has(
        `${registration.event_category_id}:${registration.athlete_profile_id}`,
      )
        ? []
        : [registration.id]
    );
    if (extraRegistrationIds.length) {
      const { error: extraRegistrationError } = await adminClient
        .from("registrations")
        .update({
          status: "cancelled",
          participation_status: "not_started",
          result_status: "uncomputed",
          updated_at: now.toISOString(),
        })
        .in("id", extraRegistrationIds);
      if (extraRegistrationError) throw extraRegistrationError;
    }

    const { error: profileError } = await adminClient
      .from("athlete_registration_profiles")
      .upsert(
        athleteRows.map((athlete, index) => {
          const athleteProfileId = athleteBySlug.get(athlete.slug);
          if (!athleteProfileId) throw new Error(`Missing ${athlete.slug}`);
          return {
            athlete_profile_id: athleteProfileId,
            phone: `+3859900${String(index + 1).padStart(4, "0")}`,
            emergency_contact_name: "Test Emergency Contact",
            emergency_contact_phone: "+38599111222",
            shirt_size: ["S", "M", "L"][index % 3],
          };
        }),
        {
          onConflict: "athlete_profile_id",
        },
      );
    if (profileError) throw profileError;

    await ensureLocalDemoTimerAssignment(
      session,
      organizationId,
      edition.id,
      env,
    );
    return getPracticeRaceState(session, edition.id, env);
  } catch (error) {
    // Every deterministic practice fixture above is retry-safe. If a later
    // insert fails, preserve the completed pieces so the next request can
    // repair the baseline without deleting immutable registration history.
    throw error;
  }
}

export type CreatePracticeRegistrationInput = {
  eventCategoryId: string;
  firstName: string;
  lastName: string;
  birthYear: number;
  gender: "F" | "M" | "U";
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

export async function createPracticeRegistration(
  session: RequestSession,
  editionId: string,
  input: CreatePracticeRegistrationInput,
  env: ServerEnv = loadServerEnv(),
): Promise<PracticeRaceState> {
  await requirePracticeEdition(session, editionId, "entrants.manage", env);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    throw badRequest("Enter the athlete's first and last name");
  }
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(input.birthYear) || input.birthYear < 1900 || input.birthYear > currentYear) {
    throw badRequest(`Enter a birth year between 1900 and ${currentYear}`);
  }
  if (!(["F", "M", "U"] as const).includes(input.gender)) {
    throw badRequest("Choose the athlete's gender");
  }
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  const city = input.city?.trim() || null;
  const emergencyContactName = input.emergencyContactName?.trim() || null;
  const emergencyContactPhone = input.emergencyContactPhone?.trim() || null;

  const adminClient = createAdminSupabaseClient(env);
  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id")
    .eq("id", input.eventCategoryId)
    .eq("event_edition_id", editionId)
    .maybeSingle<{ id: string }>();
  if (categoryError) throw categoryError;
  if (!category) throw notFound("Test race category not found");

  const categories = await listPracticeCategories(editionId, env);
  const categoryIds = categories.map((item) => item.id);
  const [{ count: totalCount, error: totalError }, { count: categoryCount, error: countError }] = await Promise.all([
    adminClient
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds)
      .in("status", ["draft", "pending", "confirmed", "waitlisted"]),
    adminClient
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_category_id", category.id)
      .in("status", ["draft", "pending", "confirmed", "waitlisted"]),
  ]);
  if (totalError) throw totalError;
  if (countError) throw countError;
  const totalLimit = Math.max(PRACTICE_RUNNER_LIMIT, categories.reduce((sum, row, index) => sum + practiceCategoryPolicy(row, index).seedRunnerCount, 0));
  const categoryIndex = categories.findIndex((row) => row.id === category.id);
  const categoryLimit = Math.max(PRACTICE_CATEGORY_CAPACITY, practiceCategoryPolicy(categories[categoryIndex], categoryIndex).seedRunnerCount);
  if ((totalCount ?? 0) >= totalLimit) throw conflict(`Test Race is limited to ${totalLimit} athletes`);
  if ((categoryCount ?? 0) >= categoryLimit) throw conflict(`This test race is limited to ${categoryLimit} athletes`);

  const athleteToken = randomUUID().replaceAll("-", "");
  const displayName = `${firstName} ${lastName}`;
  const { data: athlete, error: athleteError } = await adminClient
    .from("athlete_profiles")
    .insert({
      slug: `practice-manual-${athleteToken}`,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      gender: input.gender,
      date_of_birth: `${input.birthYear}-01-01`,
      primary_email: email,
      country_code: "HR",
      city,
      status: "practice",
      is_claimed: false,
    })
    .select("id")
    .single<{ id: string }>();
  if (athleteError) throw athleteError;

  try {
    const { error: profileError } = await adminClient
      .from("athlete_registration_profiles")
      .insert({
        athlete_profile_id: athlete.id,
        phone,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        shirt_size: null,
      });
    if (profileError) throw profileError;

    const now = new Date().toISOString();
    const { error: registrationError } = await adminClient
      .from("registrations")
      .insert({
        athlete_profile_id: athlete.id,
        event_category_id: category.id,
        status: "confirmed",
        payment_status: "not_required",
        participation_status: "not_started",
        result_status: "uncomputed",
        source: "practice",
        consent_basis: "athlete_accepted",
        confirmed_at: now,
        public_start_list_opt_in: false,
      });
    if (registrationError) throw registrationError;
  } catch (error) {
    await adminClient
      .from("athlete_registration_profiles")
      .delete()
      .eq("athlete_profile_id", athlete.id);
    await adminClient.from("athlete_profiles").delete().eq("id", athlete.id);
    throw error;
  }

  return getPracticeRaceState(session, editionId, env);
}

export async function assignPracticeRaceBibs(
  session: RequestSession,
  editionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PracticeRaceState> {
  await requirePracticeEdition(session, editionId, "entrants.manage", env);
  const categories = await listPracticeCategories(editionId, env);

  for (const [index, category] of categories.entries()) {
    const blueprint = practiceCategoryPolicy(category, index);
    const adminClient = createAdminSupabaseClient(env);
    const [{ count: bibCount, error: bibError }, { count: registrationCount, error: registrationError }] = await Promise.all([
      adminClient
      .from("bib_assignments")
      .select("id", { count: "exact", head: true })
      .eq("event_edition_id", editionId)
      .eq("event_category_id", category.id)
      .is("revoked_at", null),
      adminClient
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_category_id", category.id)
        .in("status", ["draft", "pending", "confirmed", "waitlisted"]),
    ]);
    if (bibError) throw bibError;
    if (registrationError) throw registrationError;
    if ((bibCount ?? 0) >= (registrationCount ?? 0)) continue;
    await allocateCategoryBibs(
      session,
      category.id,
      {
        startNumber: blueprint.bibStart,
        idempotencyKey: `practice:${editionId}:${category.id}:${blueprint.bibStart}:${registrationCount ?? 0}`,
      },
      env,
    );
  }

  await preparePracticeTiming(session, editionId, env);
  return getPracticeRaceState(session, editionId, env);
}

async function deleteWhereIn(
  table: string,
  column: string,
  values: string[],
  env: ServerEnv,
) {
  if (!values.length) return;
  const adminClient = createAdminSupabaseClient(env);
  for (let offset = 0; offset < values.length; offset += 100) {
    const { error } = await adminClient.from(table).delete().in(column, values.slice(offset, offset + 100));
    if (error) throw error;
  }
}

export async function resetPracticeRace(
  session: RequestSession,
  editionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PracticeRaceState> {
  await requirePracticeEdition(session, editionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const categories = await listPracticeCategories(editionId, env);
  const categoryIds = categories.map((category) => category.id);
  const registrations = categoryIds.length ? await readPracticeRegistrations((from, to) => adminClient
    .from("registrations").select("id,event_category_id,participation_status,created_at")
    .in("event_category_id", categoryIds).is("organizer_removed_at", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    .returns<PracticeRegistrationRow[]>()) : [];
  const registrationIds = (registrations ?? []).map((registration) => registration.id);

  const { data: publications, error: publicationError } = categoryIds.length
    ? await adminClient
        .from("result_publications")
        .select("id")
        .in("event_category_id", categoryIds)
        .returns<Array<{ id: string }>>()
    : { data: [] as Array<{ id: string }>, error: null };
  if (publicationError) throw publicationError;
  const publicationIds = (publications ?? []).map((publication) => publication.id);

  const [
    { data: timingSessions, error: sessionError },
    { data: resultRuns, error: resultRunError },
  ] = await Promise.all([
    adminClient
      .from("timing_sessions")
      .select("id")
      .eq("event_edition_id", editionId)
      .returns<Array<{ id: string }>>(),
    categoryIds.length
      ? adminClient
          .from("result_runs")
          .select("id")
          .in("event_category_id", categoryIds)
          .returns<Array<{ id: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
  ]);
  if (sessionError) throw sessionError;
  if (resultRunError) throw resultRunError;

  const timingSessionIds = (timingSessions ?? []).map((item) => item.id);
  const resultRunIds = (resultRuns ?? []).map((item) => item.id);

  const { error: controlsError } = await adminClient
    .from("edition_operational_controls")
    .upsert({
      event_edition_id: editionId,
      start_list_state: "open",
      current_manifest_id: null,
      frozen_at: null,
      frozen_by_user_id: null,
      reopened_at: null,
      reopened_by_user_id: null,
      reopen_reason: null,
      current_timing_plan_id: null,
      latest_rehearsal_id: null,
      timing_readiness_state: "draft",
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "event_edition_id",
    });
  if (controlsError) throw controlsError;

  await deleteWhereIn("punch_events", "timing_session_id", timingSessionIds, env);
  await deleteWhereIn("timing_sessions", "id", timingSessionIds, env);
  await deleteWhereIn("result_anomalies", "result_run_id", resultRunIds, env);
  await deleteWhereIn("result_publication_signature_events", "result_publication_id", publicationIds, env);
  await deleteWhereIn("result_publications", "id", publicationIds, env);
  await deleteWhereIn("result_complaints", "event_category_id", categoryIds, env);
  await deleteWhereIn("result_rows", "result_run_id", resultRunIds, env);
  await deleteWhereIn("result_runs", "id", resultRunIds, env);
  await deleteWhereIn("participant_statuses", "registration_id", registrationIds, env);
  await deleteWhereIn("checkins", "registration_id", registrationIds, env);
  const { error: bibError } = await adminClient
    .from("bib_assignments")
    .delete()
    .eq("event_edition_id", editionId);
  if (bibError) throw bibError;
  const { error: allocationError } = await adminClient
    .from("bib_allocation_runs")
    .delete()
    .eq("event_edition_id", editionId);
  if (allocationError) throw allocationError;
  const { error: startError } = await adminClient
    .from("race_start_events")
    .delete()
    .eq("event_edition_id", editionId);
  if (startError) throw startError;
  await deleteWhereIn("checkpoint_operation_events", "event_category_id", categoryIds, env);
  await deleteWhereIn("cutoff_actions", "event_category_id", categoryIds, env);
  await deleteWhereIn("field_accounting_signoffs", "event_category_id", categoryIds, env);
  // Start-list manifests, timing-plan versions, plan points, and rehearsal
  // records are immutable audit snapshots. Reset detaches the operational
  // pointers above and leaves those historical versions intact; the next drill
  // creates a new manifest, plan, and rehearsal version.

  const baselineRegistrationIds = new Set<string>();
  for (const [index, category] of categories.entries()) {
    const blueprint = practiceCategoryPolicy(category, index);
    const categoryRegistrations = (registrations ?? [])
      .filter((registration) => registration.event_category_id === category.id)
      .sort((left, right) =>
        (left.created_at ?? "").localeCompare(right.created_at ?? "")
        || left.id.localeCompare(right.id),
      );
    for (const registration of categoryRegistrations.slice(0, blueprint.seedRunnerCount)) {
      baselineRegistrationIds.add(registration.id);
    }
  }
  const drillRegistrationIds = registrationIds.filter(
    (registrationId) => !baselineRegistrationIds.has(registrationId),
  );
  for (let offset = 0; offset < drillRegistrationIds.length; offset += 100) {
    const { error } = await adminClient
      .from("registrations")
      .update({
        status: "cancelled",
        participation_status: "not_started",
        result_status: "uncomputed",
        updated_at: new Date().toISOString(),
      })
      .in("id", drillRegistrationIds.slice(offset, offset + 100));
    if (error) throw error;
  }

  const retainedRegistrationIds = registrationIds.filter((registrationId) =>
    baselineRegistrationIds.has(registrationId),
  );
  for (let offset = 0; offset < retainedRegistrationIds.length; offset += 100) {
    const { error } = await adminClient
      .from("registrations")
      .update({
        status: "confirmed",
        payment_status: "not_required",
        participation_status: "not_started",
        result_status: "uncomputed",
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in("id", retainedRegistrationIds.slice(offset, offset + 100));
    if (error) throw error;
  }
  if (categoryIds.length) {
    const { error } = await adminClient
      .from("event_categories")
      .update({
        status: "published",
        start_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in("id", categoryIds);
    if (error) throw error;
  }
  const { error: editionError } = await adminClient
    .from("event_editions")
    .update({
      status: "draft",
      published_at: null,
      public_visibility: "private",
      results_visibility: "private",
      updated_at: new Date().toISOString(),
    })
    .eq("id", editionId);
  if (editionError) throw editionError;

  return getPracticeRaceState(session, editionId, env);
}

export async function getPracticeRaceState(
  session: RequestSession,
  editionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PracticeRaceState> {
  const edition = await requirePracticeEdition(
    session,
    editionId,
    ["events.manage", "entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data: editionRow, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,name")
    .eq("id", editionId)
    .maybeSingle<{ id: string; name: string }>();
  if (editionError) throw editionError;
  if (!editionRow) throw notFound("Test Race not found");
  const categories = await listPracticeCategories(editionId, env);
  const categoryIds = categories.map((category) => category.id);
  const registrations = categoryIds.length ? await readPracticeRegistrations((from, to) => adminClient
    .from("registrations").select("id,event_category_id,participation_status")
    .in("event_category_id", categoryIds).is("organizer_removed_at", null)
    .in("status", ["draft", "pending", "confirmed", "waitlisted"])
    .order("id", { ascending: true }).range(from, to).returns<PracticeRegistrationRow[]>()) : [];
  const registrationIds = (registrations ?? []).map((registration) => registration.id);

  const [
    bibResult,
    checkinResult,
    startResult,
    finishPunchResult,
    controlsResult,
    teamAssignmentResult,
  ] = await Promise.all([
    adminClient
      .from("bib_assignments")
      .select("id", { count: "exact", head: true })
      .eq("event_edition_id", editionId)
      .is("revoked_at", null),
    registrationIds.length
      ? adminClient
          .from("checkins")
          .select("id,registrations!inner(event_category_id)", { count: "exact", head: true })
          .in("registrations.event_category_id", categoryIds)
      : Promise.resolve({ count: 0, error: null }),
    adminClient
      .from("race_start_events")
      .select("event_category_id")
      .eq("event_edition_id", editionId)
      .eq("event_type", "actual_start")
      .returns<Array<{ event_category_id: string }>>(),
    categoryIds.length
      ? adminClient
          .from("punch_events")
          .select("id,checkpoints!inner(checkpoint_type,event_category_id)", {
            count: "exact",
            head: true,
          })
          .in("checkpoints.event_category_id", categoryIds)
          .eq("checkpoints.checkpoint_type", "finish")
          .eq("is_voided", false)
      : Promise.resolve({ count: 0, error: null }),
    adminClient
      .from("edition_operational_controls")
      .select("timing_readiness_state")
      .eq("event_edition_id", editionId)
      .maybeSingle<{ timing_readiness_state: "draft" | "planned" | "ready" | "failed" }>(),
    adminClient
      .from("event_staff_assignments")
      .select("id", { count: "exact", head: true })
      .eq("event_edition_id", editionId)
      .neq("assignment_state", "cancelled"),
  ]);
  if (bibResult.error) throw bibResult.error;
  if (checkinResult.error) throw checkinResult.error;
  if (startResult.error) throw startResult.error;
  if (finishPunchResult.error) throw finishPunchResult.error;
  if (controlsResult.error) throw controlsResult.error;
  if (teamAssignmentResult.error) throw teamAssignmentResult.error;

  const startedCategoryCount = new Set(
    (startResult.data ?? []).map((event) => event.event_category_id),
  ).size;
  const baselineRunnerCount = categories.reduce(
    (total, category, index) => total + practiceCategoryPolicy(category, index).seedRunnerCount,
    0,
  );
  return {
    editionId,
    organizationId: edition.organizationId,
    name: editionRow.name,
    isPractice: true,
    totalRunners: registrations?.length ?? 0,
    bibAssignedCount: bibResult.count ?? 0,
    checkedInCount: checkinResult.count ?? 0,
    startedCategoryCount,
    finishPunchCount: finishPunchResult.count ?? 0,
    finishedRunnerCount: (registrations ?? []).filter(
      (registration) => registration.participation_status === "finished",
    ).length,
    timingReadinessState: controlsResult.data?.timing_readiness_state ?? "draft",
    teamAssignmentCount: teamAssignmentResult.count ?? 0,
    baselineRunnerCount,
    runnerLimit: Math.max(PRACTICE_RUNNER_LIMIT, baselineRunnerCount),
    categories: categories.map((category, index) => {
      const blueprint = practiceCategoryPolicy(category, index);
      const runnerCount = (registrations ?? []).filter(
        (registration) => registration.event_category_id === category.id,
      ).length;
      return {
        id: category.id,
        name: category.name,
        runnerCount,
        bibStart: blueprint.bibStart,
        bibEnd: blueprint.bibStart + Math.max(PRACTICE_CATEGORY_CAPACITY, blueprint.seedRunnerCount) - 1,
      };
    }),
  };
}

/** Delete only explicitly selected private drills, preserving their audit evidence. */
export async function deletePracticeRaces(
  session: RequestSession,
  organizationId: string,
  editionIds: string[],
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "events.manage");
  const ids = [...new Set(editionIds)];
  if (!ids.length || ids.length > 100) throw badRequest("Select between 1 and 100 test races");
  // Validate the complete selection before any write; one real/foreign race rejects it all.
  for (const id of ids) {
    const context = await requirePracticeEdition(session, id, "events.manage", env);
    if (context.organizationId !== organizationId) throw conflict("Test race belongs to another organization");
  }
  const adminClient = createAdminSupabaseClient(env);
  for (const id of ids) {
    const args = { p_event_edition_id: id, p_actor_user_id: session.account.userId };
    const { error: removalError } = await adminClient.rpc("service_remove_all_event_registrations", args);
    if (removalError) throw removalError;
    // Existing audited deletion also detaches tracks and closes organizer access.
    const { error: deleteError } = await adminClient.rpc("service_delete_organizer_event", args);
    if (deleteError) throw deleteError;
  }
  return { deletedEditionIds: ids };
}

export async function isPracticeEdition(
  editionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_editions")
    .select("is_practice")
    .eq("id", editionId)
    .maybeSingle<{ is_practice: boolean }>();
  if (error) throw error;
  return Boolean(data?.is_practice);
}

export async function isPracticeCategory(
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_categories")
    .select("event_editions!inner(is_practice)")
    .eq("id", categoryId)
    .maybeSingle<{
      event_editions:
        | { is_practice: boolean }
        | Array<{ is_practice: boolean }>;
    }>();
  if (error) throw error;
  const edition = Array.isArray(data?.event_editions)
    ? data.event_editions[0]
    : data?.event_editions;
  return Boolean(edition?.is_practice);
}

export async function resolvePracticeEditionOrganization(
  editionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  if (!(await isPracticeEdition(editionId, env))) {
    throw conflict("Only the private Test Race can use this action");
  }
  return (await resolveEditionContext(editionId, env)).organizationId;
}
