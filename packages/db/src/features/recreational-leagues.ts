import type { RequestSession } from "@raceson/domain/auth";
import {
  expandRecreationalSchedule,
  validateRecreationalScheduleDefinition,
  type RecreationalScheduleOverride,
} from "@raceson/domain/leagues";
import type { SportCode } from "@raceson/domain/sports";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { loadServerEnv, type ServerEnv } from "../env.js";
import { requireOrganizationAccess } from "../permissions.js";
import { createAdminSupabaseClient } from "../supabase.js";
import { reorderOrganizerLeagueRoundsChronologically } from "./league-round-ordering.js";

type RecurringCourseSettings = {
  courseFormat: "standard" | "laps";
  lapCount: number;
};

// Older saved schedules predate course settings in the category snapshot.
type RecurringCategorySnapshot = Partial<RecurringCourseSettings> & {
  coverImageUrl: string | null;
  displayOrder: number;
  elevationGainM: number | null;
  capacity: number | null;
  feeCents: number | null;
  currency: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  allowedGenders: string[];
  eligibilityNote: string | null;
  parkingLabel: string | null;
  organizerNotes: string | null;
  rulesetId: string | null;
  selectionGroupName: string | null;
  selectionGroupLimit: number | null;
  rankingConfig: unknown;
  startOffsetMs: number;
  registrationForm: RecurringRegistrationFormSnapshot | null;
};

type RecurringRegistrationFormSnapshot = {
  versionLabel: string;
  title: string;
  locale: string;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: string;
    helpText: string | null;
    placeholder: string | null;
    isRequired: boolean;
    position: number;
    options: unknown;
    validation: unknown;
  }>;
  documents: Array<{
    documentType: string;
    title: string;
    bodyMarkdown: string;
    locale: string;
    isRequired: boolean;
    position: number;
  }>;
};

type RecurringTrackSnapshot = {
  name: string;
  gpxStoragePath: string | null;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  snapshot: unknown;
};

type RecurringCheckpointSnapshot = {
  code: string;
  name: string;
  checkpointType: string;
  sequenceNumber: number;
  distanceFromStartKm: number | null;
  cutoffOffsetMs: number | null;
  isMandatory: boolean;
  settings: unknown;
};

export type RecreationalLeagueCategoryTemplateInput = {
  competitionId: string | null;
  sourceEventCategoryId: string | null;
  trackTemplateId: string;
  trackVersionId: string;
  slug: string;
  name: string;
  sportCode: SportCode;
  distanceKm?: number | null;
  selectionGroupKey?: string | null;
  resultsMode?: string;
  categorySnapshot: RecurringCategorySnapshot;
  trackSnapshot: RecurringTrackSnapshot;
  checkpoints: RecurringCheckpointSnapshot[];
};

export type CreateRecreationalLeagueScheduleInput = {
  seasonId: string;
  sourceEventEditionId: string;
  name: string;
  validFrom: string;
  validUntil: string;
  weekdays: number[];
  localStartTime: string;
  timezone?: string;
  registrationOpenDaysBefore?: number | null;
  registrationCloseMinutesBefore?: number;
  locationName?: string | null;
  mappings: Array<{
    competitionId: string;
    sourceEventCategoryId: string;
  }>;
  overrides?: RecreationalScheduleOverride[];
};

export type RecreationalLeagueScheduleRule = {
  id: string;
  seasonId: string;
  eventSeriesId: string;
  sourceEventEditionId: string | null;
  trackTemplateId: string;
  trackVersionId: string;
  name: string;
  validFrom: string;
  validUntil: string;
  weekdays: number[];
  localStartTime: string;
  timezone: string;
  registrationOpenDaysBefore: number | null;
  registrationCloseMinutesBefore: number;
  locationName: string | null;
  status: string;
  categories: Array<RecreationalLeagueCategoryTemplateInput & { id: string }>;
  overrides: Array<RecreationalScheduleOverride & { id: string }>;
  occurrences: Array<{
    id: string;
    sourceDate: string;
    scheduledDate: string;
    localStartTime: string;
    state: string;
    eventEditionId: string | null;
    leagueRoundEventId: string | null;
    failureMessage: string | null;
  }>;
  previewCount: number;
};

type SeasonContext = {
  seasonId: string;
  leagueId: string;
  startsOn: string | null;
  endsOn: string | null;
  organizationId: string;
};

export function getRecreationalLeagueTrackSportIssue(
  leagueSportCodes: readonly SportCode[],
  trackSportCode: SportCode,
) {
  return leagueSportCodes.includes(trackSportCode)
    ? null
    : "The selected route sport is not enabled for this league";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "event";
}

function normalizeTime(value: string) {
  return value.length === 5 ? `${value}:00` : value;
}

function numberOrNull(value: number | string | null | undefined) {
  return value == null || value === "" ? null : Number(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRecurringCourseSettings(courseFormat: unknown, lapCount: unknown): RecurringCourseSettings | null {
  if (
    (courseFormat === "standard" && lapCount === 1)
    || (courseFormat === "laps" && typeof lapCount === "number"
      && Number.isInteger(lapCount) && lapCount >= 2 && lapCount <= 100)
  ) {
    return { courseFormat, lapCount };
  }
  return null;
}

async function resolveRecurringCourseSettings(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  rule: RecreationalLeagueScheduleRule,
  sourceEventEditionId: string,
) {
  const settingsByTemplateId = new Map<string, RecurringCourseSettings>();
  const legacyTemplates = [] as RecreationalLeagueScheduleRule["categories"];
  for (const template of rule.categories) {
    const snapshot = recordOrEmpty(template.categorySnapshot);
    const settings = readRecurringCourseSettings(snapshot.courseFormat, snapshot.lapCount);
    if (settings) {
      settingsByTemplateId.set(template.id, settings);
    } else if (snapshot.courseFormat == null && snapshot.lapCount == null && template.sourceEventCategoryId) {
      legacyTemplates.push(template);
    } else {
      throw conflict(`Recurring race "${template.name}" has invalid route settings. Save a new schedule from the base race.`);
    }
  }
  if (!legacyTemplates.length) return settingsByTemplateId;

  const { data: sourceCategories, error } = await adminClient
    .from("event_categories")
    .select("id,course_format,lap_count")
    .eq("event_edition_id", sourceEventEditionId)
    .is("organizer_deleted_at", null)
    .in("id", legacyTemplates.map((template) => template.sourceEventCategoryId!));
  if (error) throw error;
  const sourceById = new Map((sourceCategories ?? []).map((category) => [category.id, category]));
  // Validate all missing settings before changing any stored template or round.
  for (const template of legacyTemplates) {
    const source = sourceById.get(template.sourceEventCategoryId!);
    const settings = readRecurringCourseSettings(source?.course_format, source?.lap_count);
    if (!settings) {
      throw conflict(`The base race for recurring race "${template.name}" is unavailable. Save a new schedule from the base race.`);
    }
    settingsByTemplateId.set(template.id, settings);
  }
  for (const template of legacyTemplates) {
    // Freeze the recovered settings so retries and later rounds use one snapshot.
    const { error: updateError } = await adminClient
      .from("league_recurrence_category_templates")
      .update({ category_snapshot_json: {
        ...recordOrEmpty(template.categorySnapshot),
        ...settingsByTemplateId.get(template.id)!,
      } })
      .eq("recurrence_rule_id", rule.id)
      .eq("id", template.id);
    if (updateError) throw updateError;
  }
  return settingsByTemplateId;
}

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function zonedLocalDateTimeToIso(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredWallClock;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const formattedWallClock = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += desiredWallClock - formattedWallClock;
  }

  return new Date(guess).toISOString();
}

async function loadSeasonContext(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv,
): Promise<SeasonContext> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("league_seasons")
    .select("id,starts_on,ends_on,leagues!inner(id,organization_id,name)")
    .eq("id", seasonId)
    .maybeSingle<{
      id: string;
      starts_on: string | null;
      ends_on: string | null;
      leagues: { id: string; organization_id: string; name: string };
    }>();
  if (error) throw error;
  if (!data) throw notFound("League season not found");
  requireOrganizationAccess(session, data.leagues.organization_id, "manage");
  return {
    seasonId: data.id,
    leagueId: data.leagues.id,
    startsOn: data.starts_on,
    endsOn: data.ends_on,
    organizationId: data.leagues.organization_id,
  };
}

async function loadLeagueSportCodes(
  leagueId: string,
  env: ServerEnv,
): Promise<SportCode[]> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("league_sports")
    .select("sport_code")
    .eq("league_id", leagueId)
    .returns<Array<{ sport_code: SportCode }>>();
  if (error) throw error;
  return (data ?? []).map((assignment) => assignment.sport_code);
}

export async function getRecreationalLeagueSchedules(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RecreationalLeagueScheduleRule[]> {
  await loadSeasonContext(session, seasonId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: rules, error } = await adminClient
    .from("league_recurrence_rules")
    .select("id,league_season_id,event_series_id,source_event_edition_id,track_template_id,track_version_id,name,valid_from,valid_until,weekdays,local_start_time,timezone,registration_open_days_before,registration_close_minutes_before,location_name,status")
    .eq("league_season_id", seasonId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!rules?.length) return [];

  const ruleIds = rules.map((rule) => rule.id);
  const sourceEventIds = Array.from(new Set(
    rules.map((rule) => rule.source_event_edition_id).filter((id): id is string => Boolean(id)),
  ));
  const [categoryResponse, overrideResponse, occurrenceResponse, sourceEventResponse] = await Promise.all([
    adminClient
      .from("league_recurrence_category_templates")
      .select("id,recurrence_rule_id,league_competition_id,source_event_category_id,track_template_id,track_version_id,slug,name,sport_code,distance_km,selection_group_key,results_mode,category_snapshot_json,track_snapshot_json,checkpoints_json,display_order")
      .in("recurrence_rule_id", ruleIds)
      .order("display_order", { ascending: true }),
    adminClient
      .from("league_recurrence_overrides")
      .select("id,recurrence_rule_id,source_date,action,replacement_date,replacement_local_start_time,reason")
      .in("recurrence_rule_id", ruleIds)
      .order("source_date", { ascending: true }),
    adminClient
      .from("league_recurrence_occurrences")
      .select("id,recurrence_rule_id,source_date,scheduled_date,local_start_time,state,event_edition_id,league_round_event_id,failure_message")
      .in("recurrence_rule_id", ruleIds)
      .order("scheduled_date", { ascending: true }),
    sourceEventIds.length
      ? adminClient
          .from("event_editions")
          .select("id,start_date")
          .in("id", sourceEventIds)
          .returns<Array<{ id: string; start_date: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; start_date: string }>, error: null }),
  ]);
  for (const response of [categoryResponse, overrideResponse, occurrenceResponse, sourceEventResponse]) {
    if (response.error) throw response.error;
  }
  const sourceDateByEventId = new Map(
    (sourceEventResponse.data ?? []).map((event) => [event.id, event.start_date]),
  );

  return rules.map((rule) => {
    const overrides = (overrideResponse.data ?? [])
      .filter((item) => item.recurrence_rule_id === rule.id)
      .map((item) => ({
        id: item.id,
        sourceDate: item.source_date,
        action: item.action as RecreationalScheduleOverride["action"],
        replacementDate: item.replacement_date,
        replacementLocalStartTime: item.replacement_local_start_time,
        reason: item.reason,
      }));
    const sourceDate = rule.source_event_edition_id
      ? sourceDateByEventId.get(rule.source_event_edition_id) ?? null
      : null;
    const previewCount = expandRecreationalSchedule({
      validFrom: rule.valid_from,
      validUntil: rule.valid_until,
      weekdays: rule.weekdays,
      localStartTime: rule.local_start_time,
      overrides,
    }).filter((item) => (
      item.state === "planned" && (!sourceDate || item.scheduledDate > sourceDate)
    )).length;
    return {
      id: rule.id,
      seasonId: rule.league_season_id,
      eventSeriesId: rule.event_series_id,
      sourceEventEditionId: rule.source_event_edition_id,
      trackTemplateId: rule.track_template_id,
      trackVersionId: rule.track_version_id,
      name: rule.name,
      validFrom: rule.valid_from,
      validUntil: rule.valid_until,
      weekdays: rule.weekdays,
      localStartTime: rule.local_start_time.slice(0, 5),
      timezone: rule.timezone,
      registrationOpenDaysBefore: rule.registration_open_days_before,
      registrationCloseMinutesBefore: rule.registration_close_minutes_before,
      locationName: rule.location_name,
      status: rule.status,
      categories: (categoryResponse.data ?? [])
        .filter((item) => item.recurrence_rule_id === rule.id)
        .map((item) => ({
          id: item.id,
          competitionId: item.league_competition_id,
          sourceEventCategoryId: item.source_event_category_id,
          trackTemplateId: item.track_template_id ?? rule.track_template_id,
          trackVersionId: item.track_version_id ?? rule.track_version_id,
          slug: item.slug,
          name: item.name,
          sportCode: item.sport_code as SportCode,
          distanceKm: item.distance_km == null ? null : Number(item.distance_km),
          selectionGroupKey: item.selection_group_key,
          resultsMode: item.results_mode,
          categorySnapshot: item.category_snapshot_json as RecurringCategorySnapshot,
          trackSnapshot: item.track_snapshot_json as RecurringTrackSnapshot,
          checkpoints: item.checkpoints_json as RecurringCheckpointSnapshot[],
        })),
      overrides,
      occurrences: (occurrenceResponse.data ?? [])
        .filter((item) => item.recurrence_rule_id === rule.id)
        .map((item) => ({
          id: item.id,
          sourceDate: item.source_date,
          scheduledDate: item.scheduled_date,
          localStartTime: item.local_start_time.slice(0, 5),
          state: item.state,
          eventEditionId: item.event_edition_id,
          leagueRoundEventId: item.league_round_event_id,
          failureMessage: item.failure_message,
        })),
      previewCount,
    };
  });
}

export async function createRecreationalLeagueSchedule(
  session: RequestSession,
  input: CreateRecreationalLeagueScheduleInput,
  env: ServerEnv = loadServerEnv(),
) {
  if (!session.account.hasOrganizerAccess) throw forbidden("Organizer access is required");
  const validationError = validateRecreationalScheduleDefinition({
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    weekdays: input.weekdays,
    localStartTime: input.localStartTime,
    overrides: input.overrides,
  });
  if (validationError) throw badRequest(validationError);
  if (!input.mappings.length) throw badRequest("Map at least one base-race to the league");
  const context = await loadSeasonContext(session, input.seasonId, env);
  if (context.startsOn && input.validFrom < context.startsOn) {
    throw badRequest("Schedule starts before the league season");
  }
  if (context.endsOn && input.validUntil > context.endsOn) {
    throw badRequest("Schedule ends after the league season");
  }
  if (input.overrides?.some((override) => (
    override.action === "reschedule"
    && override.replacementDate
    && (
      (context.startsOn && override.replacementDate < context.startsOn)
      || (context.endsOn && override.replacementDate > context.endsOn)
    )
  ))) {
    throw badRequest("Rescheduled races must remain inside the league season");
  }
  const timezone = input.timezone?.trim() || "Europe/Zagreb";
  if (!isValidTimezone(timezone)) throw badRequest("Use a valid IANA timezone");
  if (
    input.registrationOpenDaysBefore != null
    && input.registrationOpenDaysBefore * 1_440 < (input.registrationCloseMinutesBefore ?? 0)
  ) {
    throw badRequest("Registration must open before it closes");
  }

  const adminClient = createAdminSupabaseClient(env);
  const [
    { data: sourceEvent, error: sourceEventError },
    competitionResponse,
    leagueSportCodes,
    roundResponse,
  ] = await Promise.all([
    adminClient
      .from("event_editions")
      .select("id,event_series_id,name,start_date,timezone,location_name,is_practice,is_recurrence_generated,organizer_deleted_at")
      .eq("id", input.sourceEventEditionId)
      .maybeSingle<{
        id: string;
        event_series_id: string;
        name: string;
        start_date: string;
        timezone: string;
        location_name: string | null;
        is_practice: boolean;
        is_recurrence_generated: boolean;
        organizer_deleted_at: string | null;
      }>(),
    adminClient
      .from("league_competitions")
      .select("id,display_order")
      .eq("league_season_id", input.seasonId)
      .eq("scoring_target", "individual")
      .neq("status", "archived")
      .order("display_order", { ascending: true }),
    loadLeagueSportCodes(context.leagueId, env),
    adminClient
      .from("league_round_events")
      .select("id,event_edition_id,round_number")
      .eq("league_season_id", input.seasonId)
      .order("round_number", { ascending: true })
      .returns<Array<{ id: string; event_edition_id: string; round_number: number }>>(),
  ]);
  if (sourceEventError) throw sourceEventError;
  if (competitionResponse.error) throw competitionResponse.error;
  if (roundResponse.error) throw roundResponse.error;
  if (!sourceEvent) throw notFound("Base race not found");
  if (sourceEvent.organizer_deleted_at) throw notFound("Base race not found");
  if (sourceEvent.is_practice) throw conflict("Practice races cannot be used as recurring base races");
  if (sourceEvent.is_recurrence_generated) {
    throw conflict("Generated recurring races cannot be used as base races");
  }
  if (
    (context.startsOn && sourceEvent.start_date < context.startsOn)
    || (context.endsOn && sourceEvent.start_date > context.endsOn)
  ) {
    throw conflict("The Round 1 race must be inside the league season");
  }
  const storedRounds = roundResponse.data ?? [];
  const roundOne = storedRounds.find((round) => round.round_number === 1) ?? null;
  if (roundOne && roundOne.event_edition_id !== sourceEvent.id) {
    throw conflict(
      "This season already has a different Round 1 race. Select it as the recurrence base or delete all rounds first.",
    );
  }
  if (input.validFrom <= sourceEvent.start_date) {
    throw badRequest("Generated rounds must start after the Round 1 race date");
  }
  if (input.overrides?.some((override) => (
    override.action === "reschedule"
    && override.replacementDate
    && override.replacementDate <= sourceEvent.start_date
  ))) {
    throw badRequest("Rescheduled rounds must remain after the Round 1 race date");
  }
  const plannedCopies = expandRecreationalSchedule({
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    weekdays: input.weekdays,
    localStartTime: input.localStartTime,
    overrides: input.overrides,
  }).filter((occurrence) => (
    occurrence.state === "planned" && occurrence.scheduledDate > sourceEvent.start_date
  ));
  if (!plannedCopies.length) {
    throw badRequest("Choose at least one generated round date after Round 1");
  }

  const existingRoundEventIds = storedRounds.map((round) => round.event_edition_id);
  const existingRoundDateResponse = existingRoundEventIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,start_date")
        .in("id", existingRoundEventIds)
        .returns<Array<{ id: string; start_date: string }>>()
    : { data: [] as Array<{ id: string; start_date: string }>, error: null };
  if (existingRoundDateResponse.error) throw existingRoundDateResponse.error;
  const latestExistingRoundDate = (existingRoundDateResponse.data ?? []).reduce(
    (latest, event) => event.start_date > latest ? event.start_date : latest,
    "",
  );
  if (
    latestExistingRoundDate
    && plannedCopies.some((occurrence) => occurrence.scheduledDate <= latestExistingRoundDate)
  ) {
    throw conflict(
      `New recurring rounds must be scheduled after the latest existing league round (${latestExistingRoundDate}).`,
    );
  }

  const { data: sourceSeries, error: sourceSeriesError } = await adminClient
    .from("event_series")
    .select("id,organization_id")
    .eq("id", sourceEvent.event_series_id)
    .maybeSingle<{ id: string; organization_id: string }>();
  if (sourceSeriesError) throw sourceSeriesError;
  if (!sourceSeries || sourceSeries.organization_id !== context.organizationId) {
    throw conflict("Base race must belong to the league organizer");
  }

  const { data: sourceCategories, error: sourceCategoriesError } = await adminClient
    .from("event_categories")
    .select("id,slug,name,cover_image_url,sport_code,course_format,lap_count,distance_km,elevation_gain_m,capacity,registration_fee_cents,currency,minimum_age,maximum_age,allowed_genders,eligibility_note,start_at,parking_label,organizer_notes,display_order,results_mode,ranking_config_json,ruleset_id,selection_group_id")
    .eq("event_edition_id", sourceEvent.id)
    .is("organizer_deleted_at", null)
    .order("display_order", { ascending: true })
    .returns<Array<{
      id: string;
      slug: string;
      name: string;
      cover_image_url: string | null;
      sport_code: SportCode;
      course_format: RecurringCourseSettings["courseFormat"];
      lap_count: number;
      distance_km: number | string | null;
      elevation_gain_m: number | null;
      capacity: number | null;
      registration_fee_cents: number | null;
      currency: string | null;
      minimum_age: number | null;
      maximum_age: number | null;
      allowed_genders: string[];
      eligibility_note: string | null;
      start_at: string | null;
      parking_label: string | null;
      organizer_notes: string | null;
      display_order: number | null;
      results_mode: string;
      ranking_config_json: unknown;
      ruleset_id: string | null;
      selection_group_id: string | null;
    }>>();
  if (sourceCategoriesError) throw sourceCategoriesError;
  if (!sourceCategories?.length) throw conflict("Add at least one race to the base race");

  const competitionIds = new Set((competitionResponse.data ?? []).map((item) => item.id));
  const configuredCompetitionIds = new Set(input.mappings.map((mapping) => mapping.competitionId));
  const configuredSourceCategoryIds = new Set(input.mappings.map((mapping) => mapping.sourceEventCategoryId));
  const sourceCategoryIds = new Set(sourceCategories.map((category) => category.id));
  if (
    configuredCompetitionIds.size !== input.mappings.length ||
    configuredSourceCategoryIds.size !== input.mappings.length ||
    configuredCompetitionIds.size !== competitionIds.size ||
    Array.from(competitionIds).some((competitionId) => !configuredCompetitionIds.has(competitionId)) ||
    Array.from(configuredSourceCategoryIds).some((categoryId) => !sourceCategoryIds.has(categoryId))
  ) {
    throw conflict("Map one distinct base-race to every individual league competition");
  }
  if (sourceCategories.length < competitionIds.size) {
    throw conflict(`The base race must contain at least ${competitionIds.size} races`);
  }

  const sourceCategoryIdList = sourceCategories.map((category) => category.id);
  const selectionGroupIds = sourceCategories
    .map((category) => category.selection_group_id)
    .filter((value): value is string => Boolean(value));
  const [snapshotResponse, checkpointResponse, selectionGroupResponse, formVersionResponse] = await Promise.all([
    adminClient
      .from("event_category_track_snapshots")
      .select("event_category_id,track_template_id,track_version_id,snapshot_name,snapshot_gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,snapshot_json")
      .in("event_category_id", sourceCategoryIdList),
    adminClient
      .from("checkpoints")
      .select("event_category_id,code,name,checkpoint_type,sequence_number,distance_from_start_km,cutoff_at,is_mandatory,settings_json")
      .in("event_category_id", sourceCategoryIdList)
      .order("sequence_number", { ascending: true }),
    selectionGroupIds.length
      ? adminClient
          .from("event_category_selection_groups")
          .select("id,slug,name,selection_limit")
          .in("id", selectionGroupIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; slug: string; name: string; selection_limit: number }>,
          error: null,
        }),
    adminClient
      .from("registration_form_versions")
      .select("id,event_category_id,version_label,locale,title")
      .in("event_category_id", sourceCategoryIdList)
      .eq("status", "published")
      .returns<Array<{
        id: string;
        event_category_id: string;
        version_label: string;
        locale: string;
        title: string;
      }>>(),
  ]);
  if (snapshotResponse.error) throw snapshotResponse.error;
  if (checkpointResponse.error) throw checkpointResponse.error;
  if (selectionGroupResponse.error) throw selectionGroupResponse.error;
  if (formVersionResponse.error) throw formVersionResponse.error;

  const formVersionIds = (formVersionResponse.data ?? []).map((version) => version.id);
  const [formFieldResponse, formDocumentResponse] = formVersionIds.length
    ? await Promise.all([
        adminClient
          .from("registration_form_fields")
          .select("form_version_id,field_key,label,field_type,help_text,placeholder,is_required,position,options_json,validation_json")
          .in("form_version_id", formVersionIds)
          .order("position", { ascending: true }),
        adminClient
          .from("registration_legal_documents")
          .select("form_version_id,document_type,title,body_markdown,locale,is_required,position")
          .in("form_version_id", formVersionIds)
          .order("position", { ascending: true }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (formFieldResponse.error) throw formFieldResponse.error;
  if (formDocumentResponse.error) throw formDocumentResponse.error;

  if ((snapshotResponse.data ?? []).some((snapshot) => (
    typeof recordOrEmpty(snapshot.snapshot_json).recurrenceRuleId === "string"
  ))) {
    throw conflict("Generated recurring races cannot be used as base races");
  }

  const snapshotByCategoryId = new Map(
    (snapshotResponse.data ?? []).map((snapshot) => [snapshot.event_category_id, snapshot]),
  );
  if (sourceCategories.some((category) => {
    const snapshot = snapshotByCategoryId.get(category.id);
    return !snapshot?.track_template_id || !snapshot.track_version_id;
  })) {
    throw conflict("Every base-race must have a route assigned");
  }

  const trackTemplateIds = Array.from(new Set(
    (snapshotResponse.data ?? []).map((snapshot) => snapshot.track_template_id),
  ));
  const trackVersionIds = Array.from(new Set(
    (snapshotResponse.data ?? []).map((snapshot) => snapshot.track_version_id),
  ));
  const [trackResponse, versionResponse] = await Promise.all([
    adminClient
      .from("track_templates")
      .select("id,organization_id,slug,sport_code")
      .in("id", trackTemplateIds),
    adminClient
      .from("track_versions")
      .select("id,track_template_id")
      .in("id", trackVersionIds),
  ]);
  if (trackResponse.error) throw trackResponse.error;
  if (versionResponse.error) throw versionResponse.error;
  const trackById = new Map((trackResponse.data ?? []).map((track) => [track.id, track]));
  const versionById = new Map((versionResponse.data ?? []).map((version) => [version.id, version]));
  for (const sourceCategory of sourceCategories) {
    const snapshot = snapshotByCategoryId.get(sourceCategory.id)!;
    const track = trackById.get(snapshot.track_template_id);
    const version = versionById.get(snapshot.track_version_id);
    if (!track || track.organization_id !== context.organizationId) {
      throw conflict("Every base-race route must belong to the league organizer");
    }
    if (track.slug === "sitrail-practice-route") {
      throw conflict("Practice-only routes cannot be used for recurring league races");
    }
    const trackSportIssue = getRecreationalLeagueTrackSportIssue(
      leagueSportCodes,
      track.sport_code as SportCode,
    );
    if (trackSportIssue) throw conflict(trackSportIssue);
    if (sourceCategory.sport_code !== track.sport_code) {
      throw conflict("Every base-race must use the sport of its assigned route");
    }
    if (!version || version.track_template_id !== track.id) {
      throw conflict("Every base-race route version must belong to its assigned route");
    }
  }

  const mappingBySourceCategoryId = new Map(
    input.mappings.map((mapping) => [mapping.sourceEventCategoryId, mapping]),
  );
  const selectionGroupSlugById = new Map(
    (selectionGroupResponse.data ?? []).map((group) => [group.id, group.slug]),
  );
  const selectionGroupById = new Map(
    (selectionGroupResponse.data ?? []).map((group) => [group.id, group]),
  );
  const registrationFormByCategoryId = new Map<string, RecurringRegistrationFormSnapshot>();
  for (const version of formVersionResponse.data ?? []) {
    registrationFormByCategoryId.set(version.event_category_id, {
      versionLabel: version.version_label,
      title: version.title,
      locale: version.locale,
      fields: (formFieldResponse.data ?? [])
        .filter((field) => field.form_version_id === version.id)
        .map((field) => ({
          fieldKey: field.field_key,
          label: field.label,
          fieldType: field.field_type,
          helpText: field.help_text,
          placeholder: field.placeholder,
          isRequired: field.is_required,
          position: field.position,
          options: field.options_json,
          validation: field.validation_json,
        })),
      documents: (formDocumentResponse.data ?? [])
        .filter((document) => document.form_version_id === version.id)
        .map((document) => ({
          documentType: document.document_type,
          title: document.title,
          bodyMarkdown: document.body_markdown,
          locale: document.locale,
          isRequired: document.is_required,
          position: document.position,
        })),
    });
  }
  const sourceStartTimes = sourceCategories
    .map((category) => category.start_at ? Date.parse(category.start_at) : Number.NaN)
    .filter(Number.isFinite);
  const firstSourceStartTime = sourceStartTimes.length ? Math.min(...sourceStartTimes) : null;
  const categoryTemplates: RecreationalLeagueCategoryTemplateInput[] = sourceCategories.map((category) => {
    const mapping = mappingBySourceCategoryId.get(category.id) ?? null;
    const trackSnapshot = snapshotByCategoryId.get(category.id)!;
    const categoryStartTime = category.start_at ? Date.parse(category.start_at) : Number.NaN;
    const checkpoints = (checkpointResponse.data ?? [])
      .filter((checkpoint) => checkpoint.event_category_id === category.id)
      .map((checkpoint): RecurringCheckpointSnapshot => {
        const cutoffTime = checkpoint.cutoff_at ? Date.parse(checkpoint.cutoff_at) : Number.NaN;
        return {
          code: checkpoint.code,
          name: checkpoint.name,
          checkpointType: checkpoint.checkpoint_type,
          sequenceNumber: checkpoint.sequence_number,
          distanceFromStartKm: numberOrNull(checkpoint.distance_from_start_km),
          cutoffOffsetMs: Number.isFinite(cutoffTime) && Number.isFinite(categoryStartTime)
            ? cutoffTime - categoryStartTime
            : null,
          isMandatory: checkpoint.is_mandatory,
          settings: checkpoint.settings_json,
        };
      });
    return {
      competitionId: mapping?.competitionId ?? null,
      sourceEventCategoryId: category.id,
      trackTemplateId: trackSnapshot.track_template_id,
      trackVersionId: trackSnapshot.track_version_id,
      slug: category.slug,
      name: category.name,
      sportCode: category.sport_code,
      distanceKm: numberOrNull(category.distance_km),
      selectionGroupKey: category.selection_group_id
        ? selectionGroupSlugById.get(category.selection_group_id) ?? null
        : null,
      resultsMode: category.results_mode,
      categorySnapshot: {
        courseFormat: category.course_format,
        lapCount: category.lap_count,
        coverImageUrl: category.cover_image_url,
        displayOrder: category.display_order ?? 0,
        elevationGainM: category.elevation_gain_m,
        capacity: category.capacity,
        feeCents: category.registration_fee_cents,
        currency: category.currency,
        minimumAge: category.minimum_age,
        maximumAge: category.maximum_age,
        allowedGenders: category.allowed_genders,
        eligibilityNote: category.eligibility_note,
        parkingLabel: category.parking_label,
        organizerNotes: category.organizer_notes,
        rulesetId: category.ruleset_id,
        selectionGroupName: category.selection_group_id
          ? selectionGroupById.get(category.selection_group_id)?.name ?? null
          : null,
        selectionGroupLimit: category.selection_group_id
          ? selectionGroupById.get(category.selection_group_id)?.selection_limit ?? null
          : null,
        rankingConfig: category.ranking_config_json,
        startOffsetMs: Number.isFinite(categoryStartTime) && firstSourceStartTime != null
          ? categoryStartTime - firstSourceStartTime
          : 0,
        registrationForm: registrationFormByCategoryId.get(category.id) ?? null,
      },
      trackSnapshot: {
        name: trackSnapshot.snapshot_name,
        gpxStoragePath: trackSnapshot.snapshot_gpx_storage_path,
        distanceKm: numberOrNull(trackSnapshot.distance_km),
        elevationGainM: trackSnapshot.elevation_gain_m,
        elevationLossM: trackSnapshot.elevation_loss_m,
        snapshot: trackSnapshot.snapshot_json,
      },
      checkpoints,
    };
  });
  const primaryCategory = categoryTemplates[0]!;
  const { data: rule, error: ruleError } = await adminClient
    .from("league_recurrence_rules")
    .insert({
      league_season_id: input.seasonId,
      event_series_id: sourceEvent.event_series_id,
      source_event_edition_id: sourceEvent.id,
      track_template_id: primaryCategory.trackTemplateId,
      track_version_id: primaryCategory.trackVersionId,
      name: input.name.trim(),
      valid_from: input.validFrom,
      valid_until: input.validUntil,
      weekdays: Array.from(new Set(input.weekdays)).sort((left, right) => left - right),
      local_start_time: normalizeTime(input.localStartTime),
      timezone,
      registration_open_days_before: input.registrationOpenDaysBefore ?? null,
      registration_close_minutes_before: input.registrationCloseMinutesBefore ?? 0,
      location_name: input.locationName?.trim() || sourceEvent.location_name,
      status: "active",
      created_by_user_id: session.account.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (ruleError) throw ruleError;

  try {
    const { error: categoryError } = await adminClient
      .from("league_recurrence_category_templates")
      .insert(categoryTemplates.map((category, displayOrder) => ({
        recurrence_rule_id: rule.id,
        league_competition_id: category.competitionId,
        source_event_category_id: category.sourceEventCategoryId,
        track_template_id: category.trackTemplateId,
        track_version_id: category.trackVersionId,
        slug: slugify(category.slug || category.name),
        name: category.name.trim(),
        sport_code: category.sportCode,
        distance_km: category.distanceKm ?? null,
        selection_group_key: category.selectionGroupKey?.trim() || null,
        results_mode: category.resultsMode?.trim() || "standard",
        category_snapshot_json: category.categorySnapshot,
        track_snapshot_json: category.trackSnapshot,
        checkpoints_json: category.checkpoints,
        display_order: displayOrder,
      })));
    if (categoryError) throw categoryError;
    if (input.overrides?.length) {
      const { error: overrideError } = await adminClient
        .from("league_recurrence_overrides")
        .insert(input.overrides.map((override) => ({
          recurrence_rule_id: rule.id,
          source_date: override.sourceDate,
          action: override.action,
          replacement_date: override.action === "reschedule" ? override.replacementDate : null,
          replacement_local_start_time: override.action === "reschedule"
            ? override.replacementLocalStartTime ?? null
            : null,
          reason: override.reason?.trim() || null,
          created_by_user_id: session.account.userId,
        })));
      if (overrideError) throw overrideError;
    }
  } catch (error) {
    await adminClient.from("league_recurrence_rules").delete().eq("id", rule.id);
    throw error;
  }

  return (await getRecreationalLeagueSchedules(session, input.seasonId, env))
    .find((candidate) => candidate.id === rule.id)!;
}

export async function materializeRecreationalLeagueSchedule(
  session: RequestSession,
  seasonId: string,
  ruleId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const context = await loadSeasonContext(session, seasonId, env);
  const schedules = await getRecreationalLeagueSchedules(session, seasonId, env);
  const rule = schedules.find((candidate) => candidate.id === ruleId);
  if (!rule) throw notFound("Recurring schedule not found");
  if (!rule.sourceEventEditionId) throw conflict("Recurring schedule base race is missing");
  const adminClient = createAdminSupabaseClient(env);
  const trackTemplateIds = Array.from(new Set(rule.categories.map((category) => category.trackTemplateId)));
  const trackVersionIds = Array.from(new Set(rule.categories.map((category) => category.trackVersionId)));

  const [
    { data: series, error: seriesError },
    { data: sourceEvent, error: sourceEventError },
    trackResponse,
    versionResponse,
    roundResponse,
    leagueSportCodes,
    competitionResponse,
    sourceLocationResponse,
    sourceEligibleClubResponse,
    sourcePaymentResponse,
  ] = await Promise.all([
    adminClient
      .from("event_series")
      .select("id,slug,name,organization_id")
      .eq("id", rule.eventSeriesId)
      .single<{ id: string; slug: string; name: string; organization_id: string }>(),
    adminClient
      .from("event_editions")
      .select("id,event_series_id,start_date,status,activity_type,results_visibility,registration_access,cover_image_url,about_text,organizer_rules,website_url,instagram_url,facebook_url,general_timeline_json,organizer_deleted_at")
      .eq("id", rule.sourceEventEditionId)
      .maybeSingle<{
        id: string;
        event_series_id: string;
        start_date: string;
        status: string;
        activity_type: string;
        results_visibility: string;
        registration_access: string;
        cover_image_url: string | null;
        about_text: string | null;
        organizer_rules: string | null;
        website_url: string | null;
        instagram_url: string | null;
        facebook_url: string | null;
        general_timeline_json: unknown;
        organizer_deleted_at: string | null;
      }>(),
    adminClient
      .from("track_templates")
      .select("id,organization_id,sport_code")
      .in("id", trackTemplateIds)
      .returns<Array<{ id: string; organization_id: string; sport_code: SportCode }>>(),
    adminClient
      .from("track_versions")
      .select("id,track_template_id,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m")
      .in("id", trackVersionIds)
      .returns<Array<{
        id: string;
        track_template_id: string;
        gpx_storage_path: string | null;
        distance_km: number | string | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
      }>>(),
    adminClient
      .from("league_round_events")
      .select("id,event_edition_id,round_number")
      .eq("league_season_id", seasonId)
      .order("round_number", { ascending: true })
      .returns<Array<{ id: string; event_edition_id: string; round_number: number }>>(),
    loadLeagueSportCodes(context.leagueId, env),
    adminClient
      .from("league_competitions")
      .select("id")
      .eq("league_season_id", seasonId)
      .eq("scoring_target", "individual")
      .neq("status", "archived"),
    adminClient
      .from("event_locations")
      .select("location_type,label,description,place_label,latitude,longitude,display_order")
      .eq("event_edition_id", rule.sourceEventEditionId)
      .order("display_order", { ascending: true }),
    adminClient
      .from("event_eligible_clubs")
      .select("club_id")
      .eq("event_edition_id", rule.sourceEventEditionId)
      .returns<Array<{ club_id: string }>>(),
    adminClient
      .from("event_bank_transfer_settings")
      .select("organization_id,bank_transfer_profile_id,is_enabled,onsite_payment_enabled")
      .eq("event_edition_id", rule.sourceEventEditionId)
      .maybeSingle<{
        organization_id: string;
        bank_transfer_profile_id: string | null;
        is_enabled: boolean;
        onsite_payment_enabled: boolean;
      }>(),
  ]);
  if (seriesError) throw seriesError;
  if (sourceEventError) throw sourceEventError;
  if (trackResponse.error) throw trackResponse.error;
  if (versionResponse.error) throw versionResponse.error;
  if (roundResponse.error) throw roundResponse.error;
  if (competitionResponse.error) throw competitionResponse.error;
  if (sourceLocationResponse.error) throw sourceLocationResponse.error;
  if (sourceEligibleClubResponse.error) throw sourceEligibleClubResponse.error;
  if (sourcePaymentResponse.error) throw sourcePaymentResponse.error;
  if (series.organization_id !== context.organizationId) throw conflict("Race series organizer mismatch");
  if (
    !sourceEvent
    || sourceEvent.organizer_deleted_at
    || sourceEvent.event_series_id !== series.id
  ) {
    throw conflict("Recurring schedule base race is unavailable");
  }
  if (
    (context.startsOn && sourceEvent.start_date < context.startsOn)
    || (context.endsOn && sourceEvent.start_date > context.endsOn)
  ) {
    throw conflict("The Round 1 race must be inside the league season");
  }
  if (rule.validFrom <= sourceEvent.start_date) {
    throw conflict("Generated rounds must start after the Round 1 race date");
  }
  const sourceEventCoverImageUrl = sourceEvent.cover_image_url?.trim() || null;
  const trackById = new Map((trackResponse.data ?? []).map((track) => [track.id, track]));
  const versionById = new Map((versionResponse.data ?? []).map((version) => [version.id, version]));
  for (const category of rule.categories) {
    const track = trackById.get(category.trackTemplateId);
    const version = versionById.get(category.trackVersionId);
    if (!track || track.organization_id !== context.organizationId) {
      throw conflict("Recurring base-race route organizer mismatch");
    }
    const trackSportIssue = getRecreationalLeagueTrackSportIssue(
      leagueSportCodes,
      track.sport_code,
    );
    if (trackSportIssue) throw conflict(trackSportIssue);
    if (category.sportCode !== track.sport_code) {
      throw conflict("Recurring base-race and route sports do not match");
    }
    if (!version || version.track_template_id !== track.id) {
      throw conflict("Recurring base-race route version mismatch");
    }
  }
  const seasonCompetitionIds = new Set((competitionResponse.data ?? []).map((item) => item.id));
  const mappedCategories = rule.categories.filter(
    (category): category is typeof category & { competitionId: string } => Boolean(category.competitionId),
  );
  const configuredCompetitionIds = new Set(mappedCategories.map((category) => category.competitionId));
  if (
    configuredCompetitionIds.size !== mappedCategories.length
    || configuredCompetitionIds.size !== seasonCompetitionIds.size
    || Array.from(seasonCompetitionIds).some((competitionId) => !configuredCompetitionIds.has(competitionId))
  ) {
    throw conflict("Recurring schedule race categories do not match the target league season");
  }
  const storedRounds = roundResponse.data ?? [];
  const storedRoundOne = storedRounds.find((round) => round.round_number === 1) ?? null;
  if (storedRoundOne && storedRoundOne.event_edition_id !== sourceEvent.id) {
    throw conflict(
      "This season already has a different Round 1 race. Select it as the recurrence base or delete all rounds first.",
    );
  }
  if (storedRounds.length && !storedRoundOne) {
    throw conflict("League rounds are missing Round 1. Delete all rounds and generate the schedule again.");
  }
  const sourceMappings = mappedCategories.map((category) => {
    if (!category.sourceEventCategoryId) {
      throw conflict("Recurring schedule base-race mapping is missing");
    }
    return {
      league_competition_id: category.competitionId,
      event_category_id: category.sourceEventCategoryId,
    };
  });

  const existingOccurrences = new Map(rule.occurrences.map((item) => [item.sourceDate, item]));
  const expanded = expandRecreationalSchedule({
    validFrom: rule.validFrom,
    validUntil: rule.validUntil,
    weekdays: rule.weekdays,
    localStartTime: rule.localStartTime,
    overrides: rule.overrides,
  }).filter((occurrence) => occurrence.scheduledDate > sourceEvent.start_date);
  const hasPendingRounds = expanded.some((occurrence) => (
    occurrence.state === "planned" && existingOccurrences.get(occurrence.sourceDate)?.state !== "materialized"
  ));
  const courseSettingsByTemplateId = hasPendingRounds
    ? await resolveRecurringCourseSettings(adminClient, rule, sourceEvent.id)
    : new Map<string, RecurringCourseSettings>();

  let sourceRoundId = storedRounds.find(
    (round) => round.event_edition_id === sourceEvent.id,
  )?.id ?? null;
  if (!sourceRoundId) {
    const temporaryRoundNumber = Math.max(0, ...storedRounds.map((round) => round.round_number)) + 1;
    const { data: sourceRound, error: sourceRoundError } = await adminClient
      .from("league_round_events")
      .insert({
        league_season_id: seasonId,
        event_edition_id: sourceEvent.id,
        round_number: temporaryRoundNumber,
        status: "scheduled",
      })
      .select("id")
      .single<{ id: string }>();
    if (sourceRoundError) throw sourceRoundError;
    sourceRoundId = sourceRound.id;
  }

  const { error: sourceMappingError } = await adminClient
    .from("league_round_race_mappings")
    .upsert(sourceMappings.map((mapping) => ({
      league_round_event_id: sourceRoundId,
      ...mapping,
      status: "mapped",
    })), { onConflict: "league_round_event_id,league_competition_id" });
  if (sourceMappingError) throw sourceMappingError;

  const primarySourceCategoryId = sourceMappings[0]!.event_category_id;
  const { data: existingLegacySourceRound, error: existingLegacySourceRoundError } = await adminClient
    .from("league_rounds")
    .select("id")
    .eq("league_season_id", seasonId)
    .eq("event_category_id", primarySourceCategoryId)
    .maybeSingle<{ id: string }>();
  if (existingLegacySourceRoundError) throw existingLegacySourceRoundError;
  if (!existingLegacySourceRound) {
    const { data: lastLegacyRound, error: lastLegacyRoundError } = await adminClient
      .from("league_rounds")
      .select("round_number")
      .eq("league_season_id", seasonId)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ round_number: number }>();
    if (lastLegacyRoundError) throw lastLegacyRoundError;
    const { error: sourceLegacyRoundError } = await adminClient
      .from("league_rounds")
      .insert({
        league_season_id: seasonId,
        event_edition_id: sourceEvent.id,
        event_category_id: primarySourceCategoryId,
        round_number: Number(lastLegacyRound?.round_number ?? 0) + 1,
        status: "scheduled",
      });
    if (sourceLegacyRoundError) throw sourceLegacyRoundError;
  }

  await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);
  const { data: refreshedRounds, error: refreshedRoundsError } = await adminClient
    .from("league_round_events")
    .select("event_edition_id,round_number")
    .eq("league_season_id", seasonId)
    .order("round_number", { ascending: true })
    .returns<Array<{ event_edition_id: string; round_number: number }>>();
  if (refreshedRoundsError) throw refreshedRoundsError;
  if (refreshedRounds?.[0]?.event_edition_id !== sourceEvent.id) {
    throw conflict("The selected base race must remain the earliest league race and Round 1");
  }
  let nextRoundNumber = Math.max(0, ...(refreshedRounds ?? []).map((round) => round.round_number)) + 1;
  const staleOccurrenceSourceDates = rule.occurrences
    .filter((occurrence) => occurrence.scheduledDate <= sourceEvent.start_date)
    .map((occurrence) => occurrence.sourceDate);
  if (staleOccurrenceSourceDates.length) {
    const { error: staleOccurrenceError } = await adminClient
      .from("league_recurrence_occurrences")
      .delete()
      .eq("recurrence_rule_id", rule.id)
      .in("source_date", staleOccurrenceSourceDates);
    if (staleOccurrenceError) throw staleOccurrenceError;
  }
  const copiedEditionFields = {
    activity_type: sourceEvent.activity_type,
    results_visibility: sourceEvent.results_visibility,
    registration_access: sourceEvent.registration_access,
    cover_image_url: sourceEventCoverImageUrl,
    about_text: sourceEvent.about_text,
    organizer_rules: sourceEvent.organizer_rules,
    website_url: sourceEvent.website_url,
    instagram_url: sourceEvent.instagram_url,
    facebook_url: sourceEvent.facebook_url,
    general_timeline_json: sourceEvent.general_timeline_json,
  };

  for (const occurrence of expanded) {
    const existingOccurrence = existingOccurrences.get(occurrence.sourceDate);
    if (existingOccurrence?.state === "materialized") continue;
    if (occurrence.state !== "planned") {
      const { error } = await adminClient.from("league_recurrence_occurrences").upsert({
        recurrence_rule_id: rule.id,
        source_date: occurrence.sourceDate,
        scheduled_date: occurrence.scheduledDate,
        local_start_time: normalizeTime(occurrence.localStartTime),
        state: occurrence.state,
        failure_message: null,
      }, { onConflict: "recurrence_rule_id,source_date" });
      if (error) throw error;
      continue;
    }

    let generatedEventEditionId: string | null = existingOccurrence?.eventEditionId ?? null;
    try {
      const startAt = zonedLocalDateTimeToIso(
        occurrence.scheduledDate,
        occurrence.localStartTime,
        rule.timezone,
      );
      const startTimeMs = Date.parse(startAt);
      const registrationOpenAt = rule.registrationOpenDaysBefore == null
        ? null
        : new Date(startTimeMs - rule.registrationOpenDaysBefore * 86_400_000).toISOString();
      const registrationCloseAt = new Date(
        startTimeMs - rule.registrationCloseMinutesBefore * 60_000,
      ).toISOString();
      const editionSlug = slugify(
        `${series.slug}-${rule.name}-${occurrence.scheduledDate}-${occurrence.localStartTime}-${rule.id}`,
      );
      const { data: existingEdition, error: existingEditionError } = await adminClient
        .from("event_editions")
        .select("id,status,published_at,is_recurrence_generated,recurrence_rule_id")
        .eq("event_series_id", series.id)
        .eq("slug", editionSlug)
        .maybeSingle<{
          id: string;
          status: string;
          published_at: string | null;
          is_recurrence_generated: boolean;
          recurrence_rule_id: string | null;
        }>();
      if (existingEditionError) throw existingEditionError;
      let eventEditionId = existingEdition?.id;
      generatedEventEditionId = eventEditionId ?? null;
      if (existingEdition) {
        if (
          !existingEdition.is_recurrence_generated
          || existingEdition.recurrence_rule_id !== rule.id
          || !["draft", "registration_open"].includes(existingEdition.status)
          || existingEdition.published_at
        ) {
          throw conflict("The generated race identifier is already in use");
        }
        const { error: editionResetError } = await adminClient
          .from("event_editions")
          .update({
            name: `${series.name} · ${occurrence.scheduledDate}`,
            start_date: occurrence.scheduledDate,
            end_date: occurrence.scheduledDate,
            timezone: rule.timezone,
            registration_open_at: registrationOpenAt,
            registration_close_at: registrationCloseAt,
            location_name: rule.locationName,
            ...copiedEditionFields,
            public_visibility: "private",
            status: "registration_open",
            organizer_deleted_at: null,
            recurrence_source_event_edition_id: rule.sourceEventEditionId,
            recurrence_source_date: occurrence.sourceDate,
          })
          .eq("id", existingEdition.id);
        if (editionResetError) throw editionResetError;
      } else {
        const { data: edition, error: editionError } = await adminClient
          .from("event_editions")
          .insert({
            event_series_id: series.id,
            slug: editionSlug,
            name: `${series.name} · ${occurrence.scheduledDate}`,
            start_date: occurrence.scheduledDate,
            end_date: occurrence.scheduledDate,
            timezone: rule.timezone,
            registration_open_at: registrationOpenAt,
            registration_close_at: registrationCloseAt,
            location_name: rule.locationName,
            ...copiedEditionFields,
            public_visibility: "private",
            status: "registration_open",
            is_recurrence_generated: true,
            recurrence_rule_id: rule.id,
            recurrence_source_event_edition_id: rule.sourceEventEditionId,
            recurrence_source_date: occurrence.sourceDate,
          })
          .select("id")
          .single<{ id: string }>();
        if (editionError) throw editionError;
        eventEditionId = edition.id;
        generatedEventEditionId = edition.id;
      }

      const { error: locationDeleteError } = await adminClient
        .from("event_locations")
        .delete()
        .eq("event_edition_id", eventEditionId);
      if (locationDeleteError) throw locationDeleteError;
      if (sourceLocationResponse.data?.length) {
        const { error: locationInsertError } = await adminClient
          .from("event_locations")
          .insert(sourceLocationResponse.data.map((location) => ({
            event_edition_id: eventEditionId,
            location_type: location.location_type,
            label: location.label,
            description: location.description,
            place_label: location.place_label,
            latitude: location.latitude,
            longitude: location.longitude,
            display_order: location.display_order,
          })));
        if (locationInsertError) throw locationInsertError;
      }

      const { error: participationAccessError } = await adminClient.rpc(
        "service_set_event_registration_access",
        {
          p_event_edition_id: eventEditionId,
          p_registration_access: sourceEvent.registration_access,
          p_club_ids: (sourceEligibleClubResponse.data ?? []).map((club) => club.club_id),
        },
      );
      if (participationAccessError) throw participationAccessError;

      if (sourcePaymentResponse.data) {
        const { error: paymentSettingError } = await adminClient
          .from("event_bank_transfer_settings")
          .upsert({
            event_edition_id: eventEditionId,
            organization_id: sourcePaymentResponse.data.organization_id,
            bank_transfer_profile_id: sourcePaymentResponse.data.bank_transfer_profile_id,
            is_enabled: sourcePaymentResponse.data.is_enabled,
            onsite_payment_enabled: sourcePaymentResponse.data.onsite_payment_enabled,
            confirmed_by_user_id: session.account.userId,
            confirmed_at: new Date().toISOString(),
          }, { onConflict: "event_edition_id" });
        if (paymentSettingError) throw paymentSettingError;
      }

      const primarySport = rule.categories[0]!.sportCode;
      const { error: deleteSportsError } = await adminClient
        .from("event_edition_sports")
        .delete()
        .eq("event_edition_id", eventEditionId);
      if (deleteSportsError) throw deleteSportsError;
      const { error: sportError } = await adminClient.from("event_edition_sports").insert(
        Array.from(new Set(rule.categories.map((category) => category.sportCode))).map((sportCode) => ({
          event_edition_id: eventEditionId,
          sport_code: sportCode,
          is_primary: sportCode === primarySport,
        })),
      );
      if (sportError) throw sportError;

      const groupIdByKey = new Map<string, string>();
      for (const groupKey of new Set(
        rule.categories.map((category) => category.selectionGroupKey).filter(Boolean) as string[],
      )) {
        const groupSnapshot = rule.categories.find(
          (category) => category.selectionGroupKey === groupKey,
        )?.categorySnapshot;
        const { data: group, error: groupError } = await adminClient
          .from("event_category_selection_groups")
          .upsert({
            event_edition_id: eventEditionId,
            slug: slugify(groupKey),
            name: groupSnapshot?.selectionGroupName
              ?? (groupKey === "distance" ? "Choose one distance" : groupKey),
            selection_limit: groupSnapshot?.selectionGroupLimit ?? 1,
          }, { onConflict: "event_edition_id,slug" })
          .select("id")
          .single<{ id: string }>();
        if (groupError) throw groupError;
        groupIdByKey.set(groupKey, group.id);
      }

      const categoryIdByCompetition = new Map<string, string>();
      for (const categoryTemplate of rule.categories) {
        const categorySnapshot = categoryTemplate.categorySnapshot ?? {} as RecurringCategorySnapshot;
        const courseSettings = courseSettingsByTemplateId.get(categoryTemplate.id)!;
        const storedTrackSnapshot = categoryTemplate.trackSnapshot ?? {} as RecurringTrackSnapshot;
        const version = versionById.get(categoryTemplate.trackVersionId)!;
        const startOffsetMs = Number.isFinite(categorySnapshot.startOffsetMs)
          ? categorySnapshot.startOffsetMs
          : 0;
        const categoryStartTimeMs = startTimeMs + startOffsetMs;
        const categoryStartAt = new Date(categoryStartTimeMs).toISOString();
        const { data: category, error: categoryError } = await adminClient
          .from("event_categories")
          .upsert({
            event_edition_id: eventEditionId,
            slug: slugify(categoryTemplate.slug),
            name: categoryTemplate.name,
            cover_image_url: categorySnapshot.coverImageUrl ?? null,
            display_order: categorySnapshot.displayOrder ?? 0,
            sport_code: categoryTemplate.sportCode,
            course_format: courseSettings.courseFormat,
            lap_count: courseSettings.lapCount,
            distance_km: categoryTemplate.distanceKm ?? null,
            elevation_gain_m: categorySnapshot.elevationGainM ?? storedTrackSnapshot.elevationGainM ?? version.elevation_gain_m,
            capacity: categorySnapshot.capacity ?? null,
            registration_fee_cents: categorySnapshot.feeCents ?? null,
            currency: categorySnapshot.currency ?? null,
            minimum_age: categorySnapshot.minimumAge ?? null,
            maximum_age: categorySnapshot.maximumAge ?? null,
            allowed_genders: categorySnapshot.allowedGenders?.length
              ? categorySnapshot.allowedGenders
              : ["F", "M", "U"],
            eligibility_note: categorySnapshot.eligibilityNote ?? null,
            start_at: categoryStartAt,
            parking_label: categorySnapshot.parkingLabel ?? null,
            organizer_notes: categorySnapshot.organizerNotes ?? null,
            ruleset_id: categorySnapshot.rulesetId ?? null,
            results_mode: categoryTemplate.resultsMode ?? "standard",
            ranking_config_json: categorySnapshot.rankingConfig ?? {},
            selection_group_id: categoryTemplate.selectionGroupKey
              ? groupIdByKey.get(categoryTemplate.selectionGroupKey) ?? null
              : null,
            status: "draft",
          }, { onConflict: "event_edition_id,slug" })
          .select("id")
          .single<{ id: string }>();
        if (categoryError) throw categoryError;
        if (categoryTemplate.competitionId) {
          categoryIdByCompetition.set(categoryTemplate.competitionId, category.id);
        }
        const { data: generatedTrackSnapshot, error: snapshotError } = await adminClient
          .from("event_category_track_snapshots")
          .upsert({
            event_category_id: category.id,
            track_template_id: categoryTemplate.trackTemplateId,
            track_version_id: categoryTemplate.trackVersionId,
            snapshot_name: storedTrackSnapshot.name || categoryTemplate.name,
            snapshot_gpx_storage_path: storedTrackSnapshot.gpxStoragePath ?? version.gpx_storage_path,
            distance_km: storedTrackSnapshot.distanceKm ?? categoryTemplate.distanceKm ?? version.distance_km,
            elevation_gain_m: storedTrackSnapshot.elevationGainM ?? version.elevation_gain_m,
            elevation_loss_m: storedTrackSnapshot.elevationLossM ?? version.elevation_loss_m,
            snapshot_json: {
              ...recordOrEmpty(storedTrackSnapshot.snapshot),
              recurrenceRuleId: rule.id,
              sourceDate: occurrence.sourceDate,
              sourceEventEditionId: rule.sourceEventEditionId,
              sourceEventCategoryId: categoryTemplate.sourceEventCategoryId,
            },
          }, { onConflict: "event_category_id" })
          .select("id")
          .single<{ id: string }>();
        if (snapshotError) throw snapshotError;

        const { error: checkpointDeleteError } = await adminClient
          .from("checkpoints")
          .delete()
          .eq("event_category_id", category.id);
        if (checkpointDeleteError) throw checkpointDeleteError;
        if (categoryTemplate.checkpoints?.length) {
          const { error: checkpointInsertError } = await adminClient
            .from("checkpoints")
            .insert(categoryTemplate.checkpoints.map((checkpoint) => ({
              event_category_id: category.id,
              track_snapshot_id: generatedTrackSnapshot.id,
              code: checkpoint.code,
              name: checkpoint.name,
              checkpoint_type: checkpoint.checkpointType,
              sequence_number: checkpoint.sequenceNumber,
              distance_from_start_km: checkpoint.distanceFromStartKm,
              cutoff_at: checkpoint.cutoffOffsetMs == null
                ? null
                : new Date(categoryStartTimeMs + checkpoint.cutoffOffsetMs).toISOString(),
              is_mandatory: checkpoint.isMandatory,
              settings_json: checkpoint.settings,
            })));
          if (checkpointInsertError) throw checkpointInsertError;
        }

        const registrationForm = categorySnapshot.registrationForm ?? null;
        if (registrationForm) {
          const { error: registrationFormError } = await adminClient.rpc(
            "service_publish_registration_configuration",
            {
              p_event_category_id: category.id,
              p_actor_user_id: session.account.userId,
              p_version_label: registrationForm.versionLabel,
              p_title: registrationForm.title,
              p_locale: registrationForm.locale,
              p_fields: registrationForm.fields.map((field) => ({
                field_key: field.fieldKey,
                label: field.label,
                field_type: field.fieldType,
                help_text: field.helpText,
                placeholder: field.placeholder,
                is_required: field.isRequired,
                position: field.position,
                options_json: field.options,
                validation_json: field.validation,
              })),
              p_documents: registrationForm.documents.map((document) => ({
                document_type: document.documentType,
                title: document.title,
                body_markdown: document.bodyMarkdown,
                locale: document.locale,
                is_required: document.isRequired,
                position: document.position,
              })),
            },
          );
          if (registrationFormError) throw registrationFormError;
        }
      }

      let leagueRoundEventId = existingOccurrence?.leagueRoundEventId ?? null;
      let materializedRoundNumber: number | null = null;
      if (!leagueRoundEventId) {
        const { data: existingRound, error: existingRoundError } = await adminClient
          .from("league_round_events")
          .select("id,round_number")
          .eq("league_season_id", seasonId)
          .eq("event_edition_id", eventEditionId)
          .maybeSingle<{ id: string; round_number: number }>();
        if (existingRoundError) throw existingRoundError;
        if (existingRound) {
          leagueRoundEventId = existingRound.id;
          materializedRoundNumber = existingRound.round_number;
        } else {
          materializedRoundNumber = nextRoundNumber;
          const { data: round, error: roundError } = await adminClient
            .from("league_round_events")
            .insert({
              league_season_id: seasonId,
              event_edition_id: eventEditionId,
              round_number: materializedRoundNumber,
              status: "scheduled",
            })
            .select("id")
            .single<{ id: string }>();
          if (roundError) throw roundError;
          leagueRoundEventId = round.id;
          nextRoundNumber += 1;
        }
      } else {
        const { data: existingRound, error: existingRoundError } = await adminClient
          .from("league_round_events")
          .select("round_number")
          .eq("id", leagueRoundEventId)
          .single<{ round_number: number }>();
        if (existingRoundError) throw existingRoundError;
        materializedRoundNumber = existingRound.round_number;
      }

      const mappings = mappedCategories.map((category) => ({
        league_round_event_id: leagueRoundEventId,
        league_competition_id: category.competitionId,
        event_category_id: categoryIdByCompetition.get(category.competitionId)!,
        status: "mapped",
      }));
      const { error: mappingError } = await adminClient
        .from("league_round_race_mappings")
        .upsert(mappings, { onConflict: "league_round_event_id,league_competition_id" });
      if (mappingError) throw mappingError;

      const primaryCategoryId = mappings[0]!.event_category_id;
      const { error: legacyRoundError } = await adminClient.from("league_rounds").upsert({
        league_season_id: seasonId,
        event_edition_id: eventEditionId,
        event_category_id: primaryCategoryId,
        round_number: materializedRoundNumber,
        status: "scheduled",
      }, { onConflict: "league_season_id,round_number" });
      if (legacyRoundError) throw legacyRoundError;

      const { error: occurrenceError } = await adminClient.from("league_recurrence_occurrences").upsert({
        recurrence_rule_id: rule.id,
        source_date: occurrence.sourceDate,
        scheduled_date: occurrence.scheduledDate,
        local_start_time: normalizeTime(occurrence.localStartTime),
        state: "materialized",
        event_edition_id: eventEditionId,
        league_round_event_id: leagueRoundEventId,
        failure_message: null,
      }, { onConflict: "recurrence_rule_id,source_date" });
      if (occurrenceError) throw occurrenceError;
    } catch (error) {
      if (generatedEventEditionId) {
        try {
          const { data: partialRounds } = await adminClient
            .from("league_round_events")
            .select("id")
            .eq("league_season_id", seasonId)
            .eq("event_edition_id", generatedEventEditionId)
            .returns<Array<{ id: string }>>();
          const partialRoundIds = (partialRounds ?? []).map((round) => round.id);

          await adminClient
            .from("league_recurrence_occurrences")
            .delete()
            .eq("recurrence_rule_id", rule.id)
            .eq("source_date", occurrence.sourceDate);
          if (partialRoundIds.length) {
            await adminClient
              .from("league_round_events")
              .delete()
              .in("id", partialRoundIds);
          }
          await adminClient
            .from("league_rounds")
            .delete()
            .eq("league_season_id", seasonId)
            .eq("event_edition_id", generatedEventEditionId);
          await adminClient.rpc("service_tombstone_orphaned_recurrence_event", {
            p_event_edition_id: generatedEventEditionId,
          });
        } catch {
          // The organizer event read model also suppresses incomplete generated
          // editions, so a cleanup failure cannot expose a phantom event.
        }
      }
      await adminClient.from("league_recurrence_occurrences").upsert({
        recurrence_rule_id: rule.id,
        source_date: occurrence.sourceDate,
        scheduled_date: occurrence.scheduledDate,
        local_start_time: normalizeTime(occurrence.localStartTime),
        state: "failed",
        failure_message: error instanceof Error ? error.message.slice(0, 1000) : "Materialization failed",
      }, { onConflict: "recurrence_rule_id,source_date" });
      throw error;
    }
  }

  await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);

  return (await getRecreationalLeagueSchedules(session, seasonId, env))
    .find((candidate) => candidate.id === ruleId)!;
}

export async function generateRecreationalLeagueSchedule(
  session: RequestSession,
  input: CreateRecreationalLeagueScheduleInput,
  env: ServerEnv = loadServerEnv(),
) {
  const rule = await createRecreationalLeagueSchedule(session, input, env);
  return materializeRecreationalLeagueSchedule(session, input.seasonId, rule.id, env);
}

export async function getLegacyImportReviewWorkspace(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const context = await loadSeasonContext(session, seasonId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: batches, error } = await adminClient
    .from("legacy_import_review_batches")
    .select("id,source_label,status,summary_json,created_at,updated_at")
    .eq("organization_id", context.organizationId)
    .eq("league_season_id", seasonId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!batches?.length) return { batches: [] };

  const batchIds = batches.map((batch) => batch.id);
  const [athleteResponse, eventResponse] = await Promise.all([
    adminClient
      .from("legacy_athlete_match_reviews")
      .select("review_batch_id,decision")
      .in("review_batch_id", batchIds),
    adminClient
      .from("legacy_event_mapping_reviews")
      .select("review_batch_id,decision")
      .in("review_batch_id", batchIds),
  ]);
  if (athleteResponse.error) throw athleteResponse.error;
  if (eventResponse.error) throw eventResponse.error;
  return {
    batches: batches.map((batch) => {
      const athletes = (athleteResponse.data ?? []).filter((item) => item.review_batch_id === batch.id);
      const events = (eventResponse.data ?? []).filter((item) => item.review_batch_id === batch.id);
      return {
        id: batch.id,
        sourceLabel: batch.source_label,
        status: batch.status,
        summary: batch.summary_json,
        athleteReviewCount: athletes.length,
        pendingAthleteReviewCount: athletes.filter((item) => item.decision === "pending").length,
        eventReviewCount: events.length,
        pendingEventReviewCount: events.filter((item) => item.decision === "pending").length,
        createdAt: batch.created_at,
        updatedAt: batch.updated_at,
      };
    }),
  };
}
