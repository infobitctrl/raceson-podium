import type { RequestSession } from "@raceson/domain/auth";
import { countryName } from "@raceson/domain/geography";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { updatePlatformAthlete, updatePlatformClub } from "./identity-governance.js";
import {
  platformRecordCapabilities,
  requirePlatformCapability,
} from "./platform-capabilities.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type PlatformRecordKind = "athletes" | "clubs" | "tracks" | "events" | "leagues";
export type PlatformEventRecordScope = "current" | "deleted" | "sandbox" | "orphaned" | "all";
export type PlatformEventLifecycle = "business" | "deleted_history" | "sandbox" | "orphaned";

export type PlatformRecordOwner = {
  ownerType: "account" | "club_membership" | "organization" | "unclaimed";
  ownerId: string | null;
  label: string;
  detail: string | null;
};

export type PlatformRecordTransferTarget = {
  ownerId: string;
  label: string;
  detail: string | null;
};

export type PlatformRecordSummary = {
  kind: PlatformRecordKind;
  recordId: string;
  slug: string;
  name: string;
  status: string;
  owner: PlatformRecordOwner;
  location: string | null;
  updatedAt: string;
  counts: Record<string, number>;
  fields: Record<string, string | null>;
  transferTargets: PlatformRecordTransferTarget[];
  transferBlockers: string[];
  lifecycle?: PlatformEventLifecycle;
};

export type PlatformRecordsPage = {
  kind: PlatformRecordKind;
  page: number;
  pageSize: number;
  total: number;
  capabilities: ReturnType<typeof platformRecordCapabilities>;
  records: PlatformRecordSummary[];
  eventScope?: PlatformEventRecordScope;
};

export type PlatformRecordDeletionBlocker = {
  code: "protected_season" | "individual_standings" | "club_standings" | "standings_versions" | "standings_events" | "legacy_import_batches";
  title: string;
  detail: string;
  resolution: string;
  href: string;
};

export type PlatformRecordDeletionCleanup = {
  code: "league_schedule_configuration";
  title: string;
  detail: string;
  href: string;
};

export type PlatformRecordDeletionPreflight = {
  kind: "leagues";
  recordId: string;
  recordName: string;
  canDelete: boolean;
  blockers: PlatformRecordDeletionBlocker[];
  cleanup: PlatformRecordDeletionCleanup[];
};

export type ListPlatformRecordsInput = {
  kind: PlatformRecordKind;
  page?: number;
  pageSize?: number;
  search?: string | null;
  eventScope?: PlatformEventRecordScope;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type EventSeriesLifecycleRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  location_name: string | null;
  country_code: string | null;
  series_status: string;
  updated_at: string;
  business_edition_count: number;
  practice_edition_count: number;
  deleted_edition_count: number;
  total_edition_count: number;
  lifecycle: PlatformEventLifecycle;
};

function cleanSearch(value: string | null | undefined) {
  return value?.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ").slice(0, 120) ?? "";
}

function normalizedPage(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value!)));
}

function organizationOwner(
  organizationId: string,
  organizations: Map<string, OrganizationRow>,
): PlatformRecordOwner {
  const organization = organizations.get(organizationId);
  return {
    ownerType: "organization",
    ownerId: organizationId,
    label: organization?.name ?? "Unknown organization",
    detail: organization ? `/${organization.slug}` : organizationId,
  };
}

async function loadOrganizations(
  organizationIds: string[],
  env: ServerEnv,
) {
  if (!organizationIds.length) return new Map<string, OrganizationRow>();
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("organizations")
    .select("id,name,slug")
    .in("id", Array.from(new Set(organizationIds)))
    .returns<OrganizationRow[]>();
  if (error) throw error;
  return new Map((data ?? []).map((organization) => [organization.id, organization]));
}

async function listAthletes(
  page: number,
  pageSize: number,
  search: string,
  env: ServerEnv,
): Promise<{ total: number; records: PlatformRecordSummary[] }> {
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("athlete_profiles")
    .select(
      "id,slug,first_name,last_name,display_name,date_of_birth,primary_email,city,country_code,is_claimed,claimed_by_user_id,status,updated_at",
      { count: "exact" },
    )
    .is("merged_into_athlete_profile_id", null)
    .neq("status", "deleted")
    .order("display_name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`display_name.ilike.${pattern},slug.ilike.${pattern},primary_email.ilike.${pattern}`);
  }
  const { data, error, count } = await query.returns<Array<{
    id: string;
    slug: string;
    first_name: string;
    last_name: string;
    display_name: string;
    date_of_birth: string | null;
    primary_email: string | null;
    city: string | null;
    country_code: string | null;
    is_claimed: boolean;
    claimed_by_user_id: string | null;
    status: string;
    updated_at: string;
  }>>();
  if (error) throw error;

  const ownerUserIds = Array.from(new Set((data ?? []).flatMap((athlete) => (
    athlete.claimed_by_user_id ? [athlete.claimed_by_user_id] : []
  ))));
  const { data: owners, error: ownersError } = ownerUserIds.length
    ? await adminClient
        .from("user_profiles")
        .select("user_id,display_name,email")
        .in("user_id", ownerUserIds)
        .returns<Array<{ user_id: string; display_name: string | null; email: string | null }>>()
    : { data: [], error: null };
  if (ownersError) throw ownersError;
  const ownerById = new Map((owners ?? []).map((owner) => [owner.user_id, owner]));

  return {
    total: count ?? 0,
    records: (data ?? []).map((athlete) => {
      const owner = athlete.claimed_by_user_id
        ? ownerById.get(athlete.claimed_by_user_id)
        : null;
      return {
        kind: "athletes",
        recordId: athlete.id,
        slug: athlete.slug,
        name: athlete.display_name,
        status: athlete.status,
        owner: athlete.claimed_by_user_id ? {
          ownerType: "account",
          ownerId: athlete.claimed_by_user_id,
          label: owner?.display_name?.trim() || owner?.email || "Account holder",
          detail: owner?.email ?? athlete.claimed_by_user_id,
        } : {
          ownerType: "unclaimed",
          ownerId: null,
          label: "Unclaimed profile",
          detail: athlete.primary_email,
        },
        location: [athlete.city, countryName(athlete.country_code)].filter(Boolean).join(", ") || null,
        updatedAt: athlete.updated_at,
        counts: {},
        fields: {
          firstName: athlete.first_name,
          lastName: athlete.last_name,
          displayName: athlete.display_name,
          dateOfBirth: athlete.date_of_birth,
          primaryEmail: athlete.primary_email,
          city: athlete.city,
          countryCode: athlete.country_code?.trim().toUpperCase() ?? null,
        },
        transferTargets: [],
        transferBlockers: [],
      };
    }),
  };
}

async function listClubs(
  page: number,
  pageSize: number,
  search: string,
  env: ServerEnv,
): Promise<{ total: number; records: PlatformRecordSummary[] }> {
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("clubs")
    .select("id,slug,name,city,region,country_code,status,verification_status,updated_at", { count: "exact" })
    .is("merged_into_club_id", null)
    .order("name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`);
  }
  const { data, error, count } = await query.returns<Array<{
    id: string;
    slug: string;
    name: string;
    city: string | null;
    region: string | null;
    country_code: string | null;
    status: string;
    verification_status: string;
    updated_at: string;
  }>>();
  if (error) throw error;
  const clubIds = (data ?? []).map((club) => club.id);
  const { data: memberships, error: membershipsError } = clubIds.length
    ? await adminClient
        .from("club_memberships")
        .select("id,club_id,athlete_profile_id,membership_role,status")
        .in("club_id", clubIds)
        .eq("status", "active")
        .returns<Array<{
          id: string;
          club_id: string;
          athlete_profile_id: string;
          membership_role: string;
          status: string;
        }>>()
    : { data: [], error: null };
  if (membershipsError) throw membershipsError;
  const athleteIds = Array.from(new Set((memberships ?? []).map((membership) => membership.athlete_profile_id)));
  const { data: athletes, error: athletesError } = athleteIds.length
    ? await adminClient
        .from("athlete_profiles")
        .select("id,display_name,slug")
        .in("id", athleteIds)
        .returns<Array<{ id: string; display_name: string; slug: string }>>()
    : { data: [], error: null };
  if (athletesError) throw athletesError;
  const athleteById = new Map((athletes ?? []).map((athlete) => [athlete.id, athlete]));
  const membershipsByClub = new Map<string, typeof memberships>();
  for (const membership of memberships ?? []) {
    const rows = membershipsByClub.get(membership.club_id) ?? [];
    rows.push(membership);
    membershipsByClub.set(membership.club_id, rows);
  }

  return {
    total: count ?? 0,
    records: (data ?? []).map((club) => {
      const clubMemberships = membershipsByClub.get(club.id) ?? [];
      const ownerMembership = clubMemberships.find((membership) => membership.membership_role === "owner");
      const ownerAthlete = ownerMembership ? athleteById.get(ownerMembership.athlete_profile_id) : null;
      return {
        kind: "clubs",
        recordId: club.id,
        slug: club.slug,
        name: club.name,
        status: club.status,
        owner: ownerMembership ? {
          ownerType: "club_membership",
          ownerId: ownerMembership.id,
          label: ownerAthlete?.display_name ?? "Club owner",
          detail: ownerAthlete ? `/${ownerAthlete.slug}` : ownerMembership.athlete_profile_id,
        } : {
          ownerType: "unclaimed",
          ownerId: null,
          label: "Owner not assigned",
          detail: null,
        },
        location: [club.city, club.region, countryName(club.country_code)].filter(Boolean).join(", ") || null,
        updatedAt: club.updated_at,
        counts: { activeMembers: clubMemberships.length },
        fields: {
          name: club.name,
          city: club.city,
          region: club.region,
          countryCode: club.country_code?.trim().toUpperCase() ?? null,
          verificationStatus: club.verification_status,
        },
        transferTargets: clubMemberships
          .filter((membership) => membership.id !== ownerMembership?.id)
          .map((membership) => {
            const athlete = athleteById.get(membership.athlete_profile_id);
            return {
              ownerId: membership.id,
              label: athlete?.display_name ?? "Active member",
              detail: athlete ? `/${athlete.slug}` : membership.athlete_profile_id,
            };
          }),
        transferBlockers: clubMemberships.some((membership) => membership.id !== ownerMembership?.id)
          ? []
          : ["Add another active club member before transferring ownership."],
      };
    }),
  };
}

async function countRelatedRows(
  table: string,
  column: string,
  value: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { count, error } = await adminClient
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

function eventLifecycleForScope(scope: PlatformEventRecordScope): PlatformEventLifecycle | null {
  if (scope === "current") return "business";
  if (scope === "deleted") return "deleted_history";
  if (scope === "sandbox") return "sandbox";
  if (scope === "orphaned") return "orphaned";
  return null;
}

function eventLifecycleCounts(row: EventSeriesLifecycleRow): Record<string, number> {
  if (row.lifecycle === "business") return { "active editions": row.business_edition_count };
  if (row.lifecycle === "sandbox") return { "sandbox editions": row.practice_edition_count };
  if (row.lifecycle === "deleted_history") return { "deleted editions": row.deleted_edition_count };
  return { editions: 0 };
}

async function listEventRecords(
  page: number,
  pageSize: number,
  search: string,
  scope: PlatformEventRecordScope,
  env: ServerEnv,
): Promise<{ total: number; records: PlatformRecordSummary[] }> {
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("platform_event_series_lifecycle")
    .select(
      "id,organization_id,slug,name,description,location_name,country_code,series_status,updated_at,business_edition_count,practice_edition_count,deleted_edition_count,total_edition_count,lifecycle",
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  const lifecycle = eventLifecycleForScope(scope);
  if (lifecycle) query = query.eq("lifecycle", lifecycle);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  }

  const { data, error, count } = await query.returns<EventSeriesLifecycleRow[]>();
  if (error) throw error;
  const rows = data ?? [];
  const organizations = await loadOrganizations(rows.map((row) => row.organization_id), env);

  const records = await Promise.all(rows.map(async (row): Promise<PlatformRecordSummary> => {
    const transferBlockers: string[] = [];
    const { data: editions, error: editionsError } = await adminClient
      .from("event_editions")
      .select("id")
      .eq("event_series_id", row.id)
      .returns<Array<{ id: string }>>();
    if (editionsError) throw editionsError;
    const editionIds = (editions ?? []).map((edition) => edition.id);
    const { data: categories, error: categoriesError } = editionIds.length
      ? await adminClient
          .from("event_categories")
          .select("id")
          .in("event_edition_id", editionIds)
          .returns<Array<{ id: string }>>()
      : { data: [], error: null };
    if (categoriesError) throw categoriesError;
    const categoryIds = (categories ?? []).map((category) => category.id);
    const { count: registrationCount, error: registrationError } = categoryIds.length
      ? await adminClient
          .from("registrations")
          .select("id", { count: "exact", head: true })
          .in("event_category_id", categoryIds)
      : { count: 0, error: null };
    if (registrationError) throw registrationError;
    if ((registrationCount ?? 0) > 0) {
      transferBlockers.push("Races with registrations keep their original seller and cannot be transferred.");
    }
    const { count: recurrenceCount, error: recurrenceError } = await adminClient
      .from("league_recurrence_rules")
      .select("id", { count: "exact", head: true })
      .eq("event_series_id", row.id)
      .neq("status", "archived");
    if (recurrenceError) throw recurrenceError;
    if ((recurrenceCount ?? 0) > 0) {
      transferBlockers.push("Archive or move active league recurrence rules before transferring this race series.");
    }

    return {
      kind: "events",
      recordId: row.id,
      slug: row.slug,
      name: row.name,
      status: row.series_status,
      owner: organizationOwner(row.organization_id, organizations),
      location: row.location_name,
      updatedAt: row.updated_at,
      counts: eventLifecycleCounts(row),
      fields: {
        name: row.name,
        description: row.description,
        locationName: row.location_name,
        countryCode: row.country_code?.trim().toUpperCase() ?? null,
      },
      transferTargets: [],
      transferBlockers,
      lifecycle: row.lifecycle,
    };
  }));

  return { total: count ?? 0, records };
}

async function listOrganizationRecords(
  kind: "tracks" | "events" | "leagues",
  page: number,
  pageSize: number,
  search: string,
  env: ServerEnv,
): Promise<{ total: number; records: PlatformRecordSummary[] }> {
  const adminClient = createAdminSupabaseClient(env);
  const table = kind === "tracks" ? "track_templates" : kind === "events" ? "event_series" : "leagues";
  const columns = kind === "tracks"
    ? "id,organization_id,slug,name,terrain_type,notes,location_label,sport_code,updated_at"
    : kind === "events"
      ? "id,organization_id,slug,name,description,location_name,country_code,status,updated_at"
      : "id,organization_id,slug,name,description,status,updated_at";
  let query = adminClient
    .from(table)
    .select(columns, { count: "exact" })
    .order("name", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<Record<string, string | null>>;
  const organizations = await loadOrganizations(rows.flatMap((row) => (
    row.organization_id ? [row.organization_id] : []
  )), env);

  const records = await Promise.all(rows.map(async (row): Promise<PlatformRecordSummary> => {
    const recordId = row.id!;
    const relatedCount = kind === "tracks"
      ? await countRelatedRows("track_versions", "track_template_id", recordId, env)
      : kind === "events"
        ? await countRelatedRows("event_editions", "event_series_id", recordId, env)
        : await countRelatedRows("league_seasons", "league_id", recordId, env);
    const transferBlockers: string[] = [];
    if (kind === "tracks") {
      const { count: recurrenceCount, error: recurrenceError } = await adminClient
        .from("league_recurrence_rules")
        .select("id", { count: "exact", head: true })
        .eq("track_template_id", recordId)
        .neq("status", "archived");
      if (recurrenceError) throw recurrenceError;
      if ((recurrenceCount ?? 0) > 0) {
        transferBlockers.push("Archive active league recurrence rules before transferring this route.");
      }
    }
    if (kind === "events") {
      const { data: editions, error: editionsError } = await adminClient
        .from("event_editions")
        .select("id")
        .eq("event_series_id", recordId)
        .returns<Array<{ id: string }>>();
      if (editionsError) throw editionsError;
      const editionIds = (editions ?? []).map((edition) => edition.id);
      const { data: categories, error: categoriesError } = editionIds.length
        ? await adminClient
            .from("event_categories")
            .select("id")
            .in("event_edition_id", editionIds)
            .returns<Array<{ id: string }>>()
        : { data: [], error: null };
      if (categoriesError) throw categoriesError;
      const categoryIds = (categories ?? []).map((category) => category.id);
      const { count: registrationCount, error: registrationError } = categoryIds.length
        ? await adminClient
            .from("registrations")
            .select("id", { count: "exact", head: true })
            .in("event_category_id", categoryIds)
        : { count: 0, error: null };
      if (registrationError) throw registrationError;
      if ((registrationCount ?? 0) > 0) {
        transferBlockers.push("Races with registrations keep their original seller and cannot be transferred.");
      }
      const { count: recurrenceCount, error: recurrenceError } = await adminClient
        .from("league_recurrence_rules")
        .select("id", { count: "exact", head: true })
        .eq("event_series_id", recordId)
        .neq("status", "archived");
      if (recurrenceError) throw recurrenceError;
      if ((recurrenceCount ?? 0) > 0) {
        transferBlockers.push("Archive or move active league recurrence rules before transferring this race series.");
      }
    }

    return {
      kind,
      recordId,
      slug: row.slug!,
      name: row.name!,
      status: kind === "tracks" ? "active" : row.status!,
      owner: organizationOwner(row.organization_id!, organizations),
      location: kind === "tracks" ? row.location_label : kind === "events" ? row.location_name : null,
      updatedAt: row.updated_at!,
      counts: {
        [kind === "tracks" ? "versions" : kind === "events" ? "editions" : "seasons"]: relatedCount,
      },
      fields: kind === "tracks" ? {
        name: row.name,
        terrainType: row.terrain_type,
        locationLabel: row.location_label,
        notes: row.notes,
        sportCode: row.sport_code,
      } : kind === "events" ? {
        name: row.name,
        description: row.description,
        locationName: row.location_name,
        countryCode: row.country_code?.trim().toUpperCase() ?? null,
      } : {
        name: row.name,
        description: row.description,
      },
      transferTargets: [],
      transferBlockers,
    };
  }));

  return { total: count ?? 0, records };
}

export async function listPlatformRecords(
  session: RequestSession,
  input: ListPlatformRecordsInput,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformRecordsPage> {
  requirePlatformCapability(session, "platform.records.view");
  const page = normalizedPage(input.page, 1, 100_000);
  const pageSize = normalizedPage(input.pageSize, 20, 50);
  const search = cleanSearch(input.search);
  const eventScope = input.eventScope ?? "current";
  const result = input.kind === "athletes"
    ? await listAthletes(page, pageSize, search, env)
    : input.kind === "clubs"
      ? await listClubs(page, pageSize, search, env)
      : input.kind === "events"
        ? await listEventRecords(page, pageSize, search, eventScope, env)
        : await listOrganizationRecords(input.kind, page, pageSize, search, env);
  return {
    kind: input.kind,
    page,
    pageSize,
    total: result.total,
    capabilities: platformRecordCapabilities(session),
    records: result.records,
    ...(input.kind === "events" ? { eventScope } : {}),
  };
}

export type UpdatePlatformRecordInput =
  | {
    kind: "athletes";
    firstName: string;
    lastName: string;
    displayName: string;
    dateOfBirth: string | null;
    primaryEmail: string | null;
    city: string | null;
    countryCode: string | null;
    status: "active" | "inactive";
  }
  | {
    kind: "clubs";
    name: string;
    city: string | null;
    region: string | null;
    countryCode: string | null;
    status: "active" | "inactive";
    verificationStatus: "unverified" | "verified" | "flagged";
  }
  | {
    kind: "tracks";
    name: string;
    terrainType: string | null;
    locationLabel: string | null;
    notes: string | null;
  }
  | {
    kind: "events";
    name: string;
    description: string | null;
    locationName: string | null;
    countryCode: string | null;
    status: "active" | "inactive";
  }
  | {
    kind: "leagues";
    name: string;
    description: string | null;
    status: "draft" | "active" | "archived";
  };

function nullableTrimmed(value: string | null | undefined) {
  return value?.trim() || null;
}

export async function updatePlatformRecord(
  session: RequestSession,
  recordId: string,
  input: UpdatePlatformRecordInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.records.edit");
  if (input.kind === "athletes") {
    return updatePlatformAthlete(session, recordId, input, env);
  }
  if (input.kind === "clubs") {
    return updatePlatformClub(session, recordId, input, env);
  }

  const adminClient = createAdminSupabaseClient(env);
  const table = input.kind === "tracks" ? "track_templates" : input.kind === "events" ? "event_series" : "leagues";
  const patch = input.kind === "tracks" ? {
    name: input.name.trim(),
    terrain_type: nullableTrimmed(input.terrainType),
    location_label: nullableTrimmed(input.locationLabel),
    notes: nullableTrimmed(input.notes),
    updated_at: new Date().toISOString(),
  } : input.kind === "events" ? {
    name: input.name.trim(),
    description: nullableTrimmed(input.description),
    location_name: nullableTrimmed(input.locationName),
    country_code: nullableTrimmed(input.countryCode)?.toUpperCase() ?? null,
    status: input.status,
    updated_at: new Date().toISOString(),
  } : {
    name: input.name.trim(),
    description: nullableTrimmed(input.description),
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  const { data: current, error: currentError } = await adminClient
    .from(table)
    .select("id")
    .eq("id", recordId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw notFound("Platform record not found.");
  const { error } = await adminClient.from(table).update(patch).eq("id", recordId);
  if (error) throw error;
  const { error: auditError } = await adminClient.from("audit_log").insert({
    actor_user_id: session.account.userId,
    entity_type: input.kind.slice(0, -1),
    entity_id: recordId,
    action: `platform.${input.kind.slice(0, -1)}_updated`,
    metadata_json: { fields: Object.keys(patch).filter((field) => field !== "updated_at") },
  });
  if (auditError) throw auditError;
  return { updated: true, recordId };
}

export type TransferPlatformRecordInput = {
  kind: PlatformRecordKind;
  expectedOwnerId: string | null;
  newOwnerId?: string | null;
  newOwnerEmail?: string | null;
  confirmationName: string;
  reason: string;
};

export type DeletePlatformRecordInput = {
  kind: PlatformRecordKind;
  confirmationName: string;
  reason: string;
};

type LeagueSeasonDeletionRow = {
  id: string;
  year: number;
  name: string;
  status: string;
  published_at: string | null;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function quotedList(values: string[]) {
  return values.map((value) => `“${value}”`).join(", ");
}

async function loadLeagueSeasonDeletionBlockers(
  season: LeagueSeasonDeletionRow,
  env: ServerEnv,
): Promise<{
  blockers: PlatformRecordDeletionBlocker[];
  cleanup: PlatformRecordDeletionCleanup[];
}> {
  const adminClient = createAdminSupabaseClient(env);
  const [individualStandings, clubStandings, standingsVersions, standingsEvents, importBatches, recurrenceRules] = await Promise.all([
    adminClient
      .from("league_individual_standings")
      .select("id", { count: "exact", head: true })
      .eq("league_season_id", season.id),
    adminClient
      .from("league_club_standings")
      .select("id", { count: "exact", head: true })
      .eq("league_season_id", season.id),
    adminClient
      .from("league_standings_versions")
      .select("id,version_number,publication_state,individual_count,club_count")
      .eq("league_season_id", season.id)
      .order("version_number", { ascending: true })
      .returns<Array<{
        id: string;
        version_number: number;
        publication_state: string;
        individual_count: number;
        club_count: number;
      }>>(),
    adminClient
      .from("league_standings_events")
      .select("id,event_type")
      .eq("league_season_id", season.id)
      .returns<Array<{ id: string; event_type: string }>>(),
    adminClient
      .from("legacy_import_review_batches")
      .select("id,source_label,status")
      .eq("league_season_id", season.id)
      .order("created_at", { ascending: true })
      .returns<Array<{ id: string; source_label: string; status: string }>>(),
    adminClient
      .from("league_recurrence_rules")
      .select("id,name,status")
      .eq("league_season_id", season.id)
      .order("created_at", { ascending: true })
      .returns<Array<{ id: string; name: string; status: string }>>(),
  ]);

  const queryError = individualStandings.error
    ?? clubStandings.error
    ?? standingsVersions.error
    ?? standingsEvents.error
    ?? importBatches.error
    ?? recurrenceRules.error;
  if (queryError) throw queryError;

  const href = `/organizer/leagues/${season.id}`;
  const seasonLabel = `${season.name} (${season.year})`;
  const blockers: PlatformRecordDeletionBlocker[] = [];
  const cleanup: PlatformRecordDeletionCleanup[] = [];

  if (season.status !== "draft" || season.published_at) {
    const lifecycle = season.published_at
      ? `published on ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(season.published_at))}`
      : `status is ${season.status}`;
    blockers.push({
      code: "protected_season",
      title: `Season “${seasonLabel}” is protected`,
      detail: `The season ${lifecycle}. Permanent deletion is limited to leagues whose seasons are still unpublished drafts.`,
      resolution: "Keep the league archived. If this lifecycle state is unexpected and the season has never been used, review the season in the league workspace.",
      href,
    });
  }

  const individualCount = individualStandings.count ?? 0;
  if (individualCount > 0) {
    blockers.push({
      code: "individual_standings",
      title: `${plural(individualCount, "individual standing row")} in “${seasonLabel}”`,
      detail: "These rows are historical competition results and are retained even after the league is archived.",
      resolution: "No cleanup action is required. Keeping the league archived is the supported final state.",
      href,
    });
  }

  const clubCount = clubStandings.count ?? 0;
  if (clubCount > 0) {
    blockers.push({
      code: "club_standings",
      title: `${plural(clubCount, "club standing row")} in “${seasonLabel}”`,
      detail: "These rows preserve club rankings and cannot be removed through Platform Records.",
      resolution: "No cleanup action is required. Keeping the league archived is the supported final state.",
      href,
    });
  }

  const versionRows = standingsVersions.data ?? [];
  if (versionRows.length > 0) {
    const versions = versionRows.map((version) => `v${version.version_number} ${version.publication_state}`);
    const competitorCount = versionRows.reduce(
      (total, version) => total + version.individual_count + version.club_count,
      0,
    );
    blockers.push({
      code: "standings_versions",
      title: `${plural(versionRows.length, "standings version")} in “${seasonLabel}”`,
      detail: `${quotedList(versions)} preserve ${plural(competitorCount, "ranking entry", "ranking entries")} across their snapshots.`,
      resolution: "Published and corrected standings versions are immutable audit history, so the league should remain archived.",
      href,
    });
  }

  const eventRows = standingsEvents.data ?? [];
  if (eventRows.length > 0) {
    const eventTypes = Array.from(new Set(eventRows.map((event) => event.event_type.replaceAll("_", " "))));
    blockers.push({
      code: "standings_events",
      title: `${plural(eventRows.length, "standings audit race")} in “${seasonLabel}”`,
      detail: `Recorded workflow: ${eventTypes.join(", ")}. These races document how standings were produced or changed.`,
      resolution: "Standings audit races are retained; no deletion action is available or required.",
      href,
    });
  }

  const batchRows = importBatches.data ?? [];
  if (batchRows.length > 0) {
    const batches = batchRows.map((batch) => `${batch.source_label} — ${batch.status}`);
    blockers.push({
      code: "legacy_import_batches",
      title: `${plural(batchRows.length, "legacy import review batch")} in “${seasonLabel}”`,
      detail: quotedList(batches),
      resolution: "The import review ledger is retained even after review is completed. Keeping the league archived is the supported final state.",
      href,
    });
  }

  const recurrenceRuleRows = recurrenceRules.data ?? [];
  const recurrenceRuleIds = recurrenceRuleRows.map((rule) => rule.id);
  if (recurrenceRuleIds.length > 0) {
    const [categoryTemplates, occurrences] = await Promise.all([
      adminClient
        .from("league_recurrence_category_templates")
        .select("id,recurrence_rule_id,name")
        .in("recurrence_rule_id", recurrenceRuleIds)
        .returns<Array<{ id: string; recurrence_rule_id: string; name: string }>>(),
      adminClient
        .from("league_recurrence_occurrences")
        .select("id,recurrence_rule_id,state")
        .in("recurrence_rule_id", recurrenceRuleIds)
        .returns<Array<{ id: string; recurrence_rule_id: string; state: string }>>(),
    ]);
    if (categoryTemplates.error) throw categoryTemplates.error;
    if (occurrences.error) throw occurrences.error;

    for (const rule of recurrenceRuleRows) {
      const templates = (categoryTemplates.data ?? []).filter((template) => template.recurrence_rule_id === rule.id);
      const ruleOccurrences = (occurrences.data ?? []).filter((occurrence) => occurrence.recurrence_rule_id === rule.id);
      const occurrenceStates = Array.from(new Set(ruleOccurrences.map((occurrence) => occurrence.state)));
      cleanup.push({
        code: "league_schedule_configuration",
        title: `Schedule “${rule.name}” in “${seasonLabel}”`,
        detail: [
          `Status: ${rule.status}.`,
          templates.length
            ? `${plural(templates.length, "category template")}: ${templates.map((template) => template.name).join(", ")}.`
            : "No category templates.",
          ruleOccurrences.length
            ? `${plural(ruleOccurrences.length, "generated occurrence")} (${occurrenceStates.join(", ")}).`
            : "No generated occurrences.",
          "This scheduling setup is not protected history and will be removed automatically with the league.",
        ].join(" "),
        href,
      });
    }
  }

  return { blockers, cleanup };
}

export async function getPlatformRecordDeletionPreflight(
  session: RequestSession,
  recordId: string,
  input: { kind: PlatformRecordKind },
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformRecordDeletionPreflight> {
  requirePlatformCapability(session, "platform.records.delete");
  if (input.kind !== "leagues") {
    throw badRequest("Detailed deletion preflight is currently available for leagues only.");
  }

  const recordName = await loadRecordName(input.kind, recordId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: seasons, error } = await adminClient
    .from("league_seasons")
    .select("id,year,name,status,published_at")
    .eq("league_id", recordId)
    .order("year", { ascending: false })
    .returns<LeagueSeasonDeletionRow[]>();
  if (error) throw error;

  const seasonPreflights = await Promise.all(
    (seasons ?? []).map((season) => loadLeagueSeasonDeletionBlockers(season, env)),
  );
  const blockers = seasonPreflights.flatMap((preflight) => preflight.blockers);
  const cleanup = seasonPreflights.flatMap((preflight) => preflight.cleanup);
  return {
    kind: "leagues",
    recordId,
    recordName,
    canDelete: blockers.length === 0,
    blockers,
    cleanup,
  };
}

function throwTransferError(error: { code?: string; message?: string }): never {
  const message = error.message ?? "Ownership transfer failed";
  if (message.includes("not_found") || message.includes("destination_not_found")) {
    throw notFound("The record or selected new owner no longer exists.");
  }
  if (message.includes("owner_changed")) {
    throw conflict("Ownership changed while this transfer was being prepared. Reload and try again.");
  }
  if (message.includes("slug_conflict")) {
    throw conflict("The destination already has a record with this URL slug.");
  }
  if (message.includes("event_transfer_has_registrations")) {
    throw conflict("Races with registrations cannot be transferred because the original seller and payment history must remain unchanged.");
  }
  if (message.includes("recurrence_conflict") || message.includes("dependency_conflict")) {
    throw conflict("Move or archive the connected league recurrence dependencies before transferring this record.");
  }
  if (message.includes("target_has_profile") || message.includes("target_identity_conflict")) {
    throw conflict("That account already owns or is linked to another athlete profile. Use the identity merge review instead.");
  }
  if (message.includes("requires_active_member")) {
    throw badRequest("Choose an active club member as the new owner.");
  }
  if (error.code === "22023" || error.code === "23514") throw badRequest(message);
  if (error.code === "23505" || error.code === "40001") throw conflict(message);
  throw error;
}

function throwDeletionError(error: { code?: string; message?: string }): never {
  const message = error.message ?? "Platform record deletion failed";
  if (message.includes("not_found")) {
    throw notFound("The platform record no longer exists.");
  }
  if (message.includes("confirmation_mismatch")) {
    throw badRequest("Type the record name exactly as shown to confirm deletion.");
  }
  if (message.includes("reason_required")) {
    throw badRequest("Enter a reason of at least 8 characters for the audit log.");
  }
  if (message.includes("athlete_profile_is_claimed")) {
    throw conflict("Claimed athlete profiles cannot be deleted here. Remove or reassign the connected account first.");
  }
  if (message.includes("athlete_profile_owns_club")) {
    throw conflict("Transfer club ownership before deleting this athlete profile.");
  }
  if (message.includes("athlete_profile_has_protected_history")) {
    throw conflict("Deletion blocked. Check this athlete for claim records; registrations, start-list entries, results, or race communications; club membership or roster history; attempts, activities, badges, or credentials; community contributions; league standings; or merged profiles.");
  }
  if (message.includes("club_has_protected_history")) {
    throw conflict("Deletion blocked. Check this club for merge history; registrations or results representing the club; aliases, verification cases, or administrator-role requests; membership or roster audit history; and league standings.");
  }
  if (message.includes("track_has_protected_history")) {
    throw conflict("Deletion blocked. Check this route for race/category assignments, league recurrence rules, attempts or athlete activities, reviews or condition reports, and badge definitions.");
  }
  if (message.includes("event_has_protected_history")) {
    throw conflict("Deletion blocked. Check for published or non-draft editions, registrations or results, league recurrence rules or rounds, reviews or photo submissions, timing sessions, and safety incidents.");
  }
  if (message.includes("league_has_protected_history")) {
    throw conflict("Deletion blocked. Check for published or non-draft seasons, individual or club standings, standings versions or race inputs, and legacy import review batches.");
  }
  if (error.code === "22023" || error.code === "23514") throw badRequest(message);
  if (error.code === "23503" || error.code === "55000") throw conflict(message);
  throw error;
}

async function loadRecordName(
  kind: PlatformRecordKind,
  recordId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const table = kind === "athletes" ? "athlete_profiles"
    : kind === "clubs" ? "clubs"
      : kind === "tracks" ? "track_templates"
        : kind === "events" ? "event_series"
          : "leagues";
  const column = kind === "athletes" ? "display_name" : "name";
  const { data, error } = await adminClient
    .from(table)
    .select(`id,${column}`)
    .eq("id", recordId)
    .maybeSingle<Record<string, string>>();
  if (error) throw error;
  if (!data) throw notFound("Platform record not found.");
  return data[column];
}

export async function transferPlatformRecordOwnership(
  session: RequestSession,
  recordId: string,
  input: TransferPlatformRecordInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.records.transfer");
  const currentName = await loadRecordName(input.kind, recordId, env);
  if (input.confirmationName.trim() !== currentName) {
    throw badRequest(`Type “${currentName}” to confirm this ownership transfer.`);
  }
  if (input.reason.trim().length < 8) {
    throw badRequest("Enter a reason of at least 8 characters for the audit log.");
  }

  const adminClient = createAdminSupabaseClient(env);
  if (input.kind === "athletes") {
    const normalizedEmail = input.newOwnerEmail?.trim().toLowerCase();
    if (!normalizedEmail) throw badRequest("Enter the new account email address.");
    const { data: account, error: accountError } = await adminClient
      .from("user_profiles")
      .select("user_id,email")
      .eq("email", normalizedEmail)
      .eq("status", "active")
      .maybeSingle<{ user_id: string; email: string | null }>();
    if (accountError) throw accountError;
    if (!account) throw notFound("No active account uses that email address.");
    const { data, error } = await adminClient.rpc("service_reassign_athlete_profile_account", {
      p_athlete_profile_id: recordId,
      p_expected_current_user_id: input.expectedOwnerId,
      p_new_user_id: account.user_id,
      p_actor_user_id: session.account.userId,
      p_reason: input.reason.trim(),
    });
    if (error) throwTransferError(error);
    return data;
  }

  if (!input.newOwnerId) throw badRequest("Choose the new owner.");
  if (input.kind === "clubs") {
    const { data, error } = await adminClient.rpc("service_transfer_club_ownership", {
      p_club_id: recordId,
      p_current_owner_membership_id: input.expectedOwnerId,
      p_new_owner_membership_id: input.newOwnerId,
      p_actor_user_id: session.account.userId,
      p_reason: input.reason.trim(),
    });
    if (error) throwTransferError(error);
    return data;
  }

  if (!input.expectedOwnerId) throw conflict("This record does not currently have an organization owner.");
  const { data, error } = await adminClient.rpc("service_transfer_platform_organization_record", {
    p_record_type: input.kind.slice(0, -1),
    p_record_id: recordId,
    p_expected_organization_id: input.expectedOwnerId,
    p_new_organization_id: input.newOwnerId,
    p_actor_user_id: session.account.userId,
    p_reason: input.reason.trim(),
  });
  if (error) throwTransferError(error);
  return data;
}

export async function deletePlatformRecord(
  session: RequestSession,
  recordId: string,
  input: DeletePlatformRecordInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.records.delete");
  const adminClient = createAdminSupabaseClient(env);
  if (input.kind === "athletes") {
    const { data, error } = await adminClient.rpc("service_retire_platform_athlete_for_deletion", {
      p_actor_user_id: session.account.userId,
      p_athlete_profile_id: recordId,
      p_confirmation_name: input.confirmationName.trim(),
      p_reason: input.reason.trim(),
      p_claimed_user_id: null,
      p_dry_run: false,
    });
    if (error) throwDeletionError(error);
    return data as {
      deleted: boolean;
      recordType: string;
      recordId: string;
      removedClubMemberships: number;
      appendedClubMembershipEvents: number;
    };
  }
  const { data, error } = await adminClient.rpc("service_delete_platform_record", {
    p_actor_user_id: session.account.userId,
    p_record_type: input.kind.slice(0, -1),
    p_record_id: recordId,
    p_confirmation_name: input.confirmationName.trim(),
    p_reason: input.reason.trim(),
  });
  if (error) throwDeletionError(error);
  return data as {
    deleted: boolean;
    recordType: string;
    recordId: string;
  };
}
