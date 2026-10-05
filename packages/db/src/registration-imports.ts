import { createHash } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type RegistrationImportInputRow = {
  rowNumber: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  category?: string;
  categoryId?: string;
  club?: string;
  clubId?: string;
  city?: string;
  countryCode?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

export type RegistrationImportRow = {
  rowNumber: number;
  status: "valid" | "invalid" | "imported" | "skipped";
  raw: Record<string, unknown>;
  normalized: {
    firstName?: string;
    lastName?: string;
    email?: string;
    dateOfBirth?: string;
    gender?: "F" | "M" | "U";
    categoryId?: string;
    categoryName?: string;
    representedClubId?: string;
    representedClubName?: string;
    city?: string;
    countryCode?: string;
    phone?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  };
  errors: string[];
  athleteProfileId: string | null;
  registrationId: string | null;
  processedAt: string | null;
};

export type RegistrationImport = {
  id: string;
  eventEditionId: string;
  sourceFileName: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  summary: Record<string, unknown>;
  createdAt: string;
  committedAt: string | null;
  rows: RegistrationImportRow[];
};

type CategoryRow = { id: string; name: string; slug: string };

export type ClubImportIdentityRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  merged_into_club_id: string | null;
};

export type ClubImportAliasRow = {
  club_id: string;
  alias_name: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeClubIdentityLookup(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll("đ", "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactClubIdentityLookup(value: string) {
  return normalizeClubIdentityLookup(value).replaceAll(" ", "");
}

function isSingleEditVariant(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    if (mismatches.length !== 2) return false;
    const [first, second] = mismatches;
    return second === first + 1
      && left[first] === right[second]
      && left[second] === right[first];
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;

  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }

  return true;
}

function buildCanonicalClubIdBySource(clubs: ClubImportIdentityRow[]) {
  const mergedIntoById = new Map(
    clubs
      .filter((club) => club.merged_into_club_id)
      .map((club) => [club.id, club.merged_into_club_id!] as const),
  );
  const canonicalIdBySource = new Map<string, string>();

  for (const club of clubs) {
    const visited = new Set<string>();
    let currentId = club.id;

    while (mergedIntoById.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      currentId = mergedIntoById.get(currentId)!;
    }

    canonicalIdBySource.set(club.id, visited.has(currentId) ? club.id : currentId);
  }

  return canonicalIdBySource;
}

export function createClubImportIdentityResolver(
  clubs: ClubImportIdentityRow[],
  aliases: ClubImportAliasRow[],
) {
  const canonicalIdBySource = buildCanonicalClubIdBySource(clubs);
  const activeClubById = new Map(
    clubs.filter((club) => club.status === "active").map((club) => [club.id, club]),
  );
  const canonicalClubFor = (clubId: string) => activeClubById.get(
    canonicalIdBySource.get(clubId) ?? clubId,
  );
  const canonicalIdByKey = new Map<string, string>();
  const ambiguousKeys = new Set<string>();
  const compactKeysByCanonicalId = new Map<string, Set<string>>();

  const addKey = (key: string, clubId: string) => {
    if (!key) return;
    const current = canonicalIdByKey.get(key);
    if (current && current !== clubId) {
      canonicalIdByKey.delete(key);
      ambiguousKeys.add(key);
      return;
    }
    if (!ambiguousKeys.has(key)) canonicalIdByKey.set(key, clubId);
  };

  const addName = (name: string, clubId: string) => {
    const normalized = normalizeClubIdentityLookup(name);
    const compact = compactClubIdentityLookup(name);
    addKey(`name:${normalized}`, clubId);
    addKey(`compact:${compact}`, clubId);
    if (compact) {
      const keys = compactKeysByCanonicalId.get(clubId) ?? new Set<string>();
      keys.add(compact);
      compactKeysByCanonicalId.set(clubId, keys);
    }
  };

  for (const club of clubs) {
    const canonicalClub = canonicalClubFor(club.id);
    if (!canonicalClub) continue;
    addKey(`raw:${club.id.toLowerCase()}`, canonicalClub.id);
    addKey(`raw:${club.slug.trim().toLowerCase()}`, canonicalClub.id);
    addName(club.name, canonicalClub.id);
  }

  for (const alias of aliases) {
    const canonicalClub = canonicalClubFor(alias.club_id);
    if (canonicalClub) addName(alias.alias_name, canonicalClub.id);
  }

  return (value: string): ClubImportIdentityRow | undefined => {
    const cleaned = clean(value);
    if (!cleaned) return undefined;

    const normalized = normalizeClubIdentityLookup(cleaned);
    const compact = compactClubIdentityLookup(cleaned);
    const exactClubId = [
      `raw:${cleaned.toLowerCase()}`,
      `name:${normalized}`,
      `compact:${compact}`,
    ].map((key) => canonicalIdByKey.get(key)).find(Boolean);
    if (exactClubId) return activeClubById.get(exactClubId);

    // A fuzzy match is accepted only for a substantial name and only when a
    // single canonical identity is one insertion, deletion, substitution, or
    // adjacent transposition away. Ambiguous candidates remain invalid.
    if (compact.length < 6) return undefined;
    const fuzzyCanonicalIds = new Set<string>();
    for (const [canonicalId, candidateKeys] of compactKeysByCanonicalId) {
      if (Array.from(candidateKeys).some((candidate) => isSingleEditVariant(compact, candidate))) {
        fuzzyCanonicalIds.add(canonicalId);
      }
    }
    if (fuzzyCanonicalIds.size !== 1) return undefined;
    return activeClubById.get(Array.from(fuzzyCanonicalIds)[0]);
  };
}

function normalizeGender(value: string): "F" | "M" | "U" | undefined {
  const normalized = value.trim().toLowerCase();
  if (["f", "female", "woman", "ž", "zensko", "žensko"].includes(normalized)) return "F";
  if (["m", "male", "man", "musko", "muško"].includes(normalized)) return "M";
  if (["u", "x", "other", "unknown", "unspecified", "nonbinary", "non-binary"].includes(normalized)) {
    return "U";
  }
  return undefined;
}

function isPastIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value < new Date().toISOString().slice(0, 10);
}

function mapImportError(error: { message?: string | null }): never {
  const message = error.message ?? "registration_import_failed";
  if (message.includes("registration_import_preview_invalid")) {
    throw badRequest("Import must contain between 1 and 2,000 rows");
  }
  if (message.includes("registration_import_not_found")) throw notFound("Registration import not found");
  if (message.includes("registration_import_not_committable")) {
    throw conflict("This import can no longer be committed");
  }
  if (message.includes("registration_import_has_invalid_rows")) {
    throw conflict("Resolve every invalid row before committing the import");
  }
  if (message.includes("start_list_is_frozen")) {
    throw conflict("Reopen the start list before importing registrations");
  }
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This request key was already used for a different import");
  }
  throw error;
}

function normalizeRows(
  rows: RegistrationImportInputRow[],
  categories: CategoryRow[],
  resolveClub: ReturnType<typeof createClubImportIdentityResolver>,
) {
  const categoryByKey = new Map<string, CategoryRow>();
  for (const category of categories) {
    categoryByKey.set(category.id.toLowerCase(), category);
    categoryByKey.set(category.slug.trim().toLowerCase(), category);
    categoryByKey.set(category.name.trim().toLowerCase(), category);
  }
  return rows.map((row, index) => {
    const errors: string[] = [];
    const firstName = clean(row.firstName);
    const lastName = clean(row.lastName);
    const email = clean(row.email).toLowerCase();
    const dateOfBirth = clean(row.dateOfBirth);
    const gender = normalizeGender(clean(row.gender));
    const categoryKey = clean(row.categoryId || row.category).toLowerCase();
    const category = categoryByKey.get(categoryKey);
    const clubKey = clean(row.clubId || row.club);
    const club = clubKey ? resolveClub(clubKey) : undefined;
    const countryCode = clean(row.countryCode).toUpperCase();

    if (!firstName) errors.push("First name is required.");
    if (!lastName) errors.push("Last name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("A valid email is required.");
    if (!isPastIsoDate(dateOfBirth)) errors.push("Date of birth must be a valid past YYYY-MM-DD date.");
    if (!gender) errors.push("Gender must be F, M, U, female, male, or unspecified.");
    if (!category) errors.push("Race must match this edition by ID, slug, or name.");
    if (clubKey && !club) errors.push("Club must match the club directory by ID, slug, or name.");
    if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
      errors.push("Choose a valid country.");
    }

    return {
      rowNumber: Number.isInteger(row.rowNumber) && row.rowNumber > 0 ? row.rowNumber : index + 2,
      raw: { ...row },
      normalized: {
        firstName,
        lastName,
        email,
        dateOfBirth,
        gender,
        categoryId: category?.id,
        categoryName: category?.name,
        representedClubId: club?.id,
        representedClubName: club?.name,
        city: clean(row.city),
        countryCode,
        phone: clean(row.phone),
        emergencyContactName: clean(row.emergencyContactName),
        emergencyContactPhone: clean(row.emergencyContactPhone),
      },
      status: errors.length ? "invalid" as const : "valid" as const,
      errors,
    };
  });
}

export async function createRegistrationImportPreview(
  session: RequestSession,
  eventEditionId: string,
  input: {
    sourceFileName?: string | null;
    mapping?: Record<string, string>;
    rows: RegistrationImportInputRow[];
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "entrants.manage", env);
  if (!input.rows.length || input.rows.length > 2_000) {
    throw badRequest("Import must contain between 1 and 2,000 rows");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: categories, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,name,slug")
    .eq("event_edition_id", eventEditionId)
    .returns<CategoryRow[]>();
  if (categoryError) throw categoryError;

  const { data: clubs, error: clubError } = await adminClient
    .from("clubs")
    .select("id,name,slug,status,merged_into_club_id")
    .returns<ClubImportIdentityRow[]>();
  if (clubError) throw clubError;

  const { data: clubAliases, error: clubAliasError } = await adminClient
    .from("club_aliases")
    .select("club_id,alias_name")
    .returns<ClubImportAliasRow[]>();
  if (clubAliasError) throw clubAliasError;

  const resolveClub = createClubImportIdentityResolver(clubs ?? [], clubAliases ?? []);
  const normalizedRows = normalizeRows(input.rows, categories ?? [], resolveClub);
  const requestHash = sha256(JSON.stringify({
    eventEditionId,
    sourceFileName: input.sourceFileName?.trim() || null,
    mapping: input.mapping ?? {},
    rows: normalizedRows,
  }));
  const { data, error } = await adminClient.rpc("service_create_registration_import_preview", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_source_file_name: input.sourceFileName?.trim() || null,
    p_idempotency_key_hash: sha256(input.idempotencyKey),
    p_request_hash: requestHash,
    p_mapping: input.mapping ?? {},
    p_rows: normalizedRows,
  });
  if (error) mapImportError(error);

  return getRegistrationImport(
    session,
    (data as { jobId: string }).jobId,
    env,
  );
}

export async function getRegistrationImport(
  session: RequestSession,
  importJobId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RegistrationImport> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: job, error: jobError } = await adminClient
    .from("import_jobs")
    .select(
      "id,event_edition_id,source_file_name,status,total_rows,valid_rows,invalid_rows,summary_json,created_at,committed_at",
    )
    .eq("id", importJobId)
    .eq("job_type", "registration_import")
    .maybeSingle<{
      id: string;
      event_edition_id: string;
      source_file_name: string | null;
      status: string;
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      summary_json: Record<string, unknown>;
      created_at: string;
      committed_at: string | null;
    }>();
  if (jobError) throw jobError;
  if (!job?.event_edition_id) throw notFound("Registration import not found");
  await requireEditionAccess(session, job.event_edition_id, "entrants.manage", env);

  const { data: rows, error: rowsError } = await adminClient
    .from("registration_import_rows")
    .select(
      "row_number,row_status,raw_json,normalized_json,errors_json,athlete_profile_id,registration_id,processed_at",
    )
    .eq("import_job_id", job.id)
    .order("row_number", { ascending: true });
  if (rowsError) throw rowsError;

  return {
    id: job.id,
    eventEditionId: job.event_edition_id,
    sourceFileName: job.source_file_name,
    status: job.status,
    totalRows: job.total_rows,
    validRows: job.valid_rows,
    invalidRows: job.invalid_rows,
    summary: job.summary_json ?? {},
    createdAt: job.created_at,
    committedAt: job.committed_at,
    rows: (rows ?? []).map((row) => ({
      rowNumber: row.row_number,
      status: row.row_status as RegistrationImportRow["status"],
      raw: row.raw_json as Record<string, unknown>,
      normalized: row.normalized_json as RegistrationImportRow["normalized"],
      errors: Array.isArray(row.errors_json)
        ? row.errors_json.filter((item): item is string => typeof item === "string")
        : [],
      athleteProfileId: row.athlete_profile_id,
      registrationId: row.registration_id,
      processedAt: row.processed_at,
    })),
  };
}

export async function commitRegistrationImport(
  session: RequestSession,
  importJobId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const preview = await getRegistrationImport(session, importJobId, env);
  if (preview.invalidRows > 0) {
    throw conflict("Resolve every invalid row before committing the import");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_commit_registration_import", {
    p_import_job_id: importJobId,
    p_actor_user_id: session.account.userId,
  });
  if (error) mapImportError(error);
  return getRegistrationImport(session, importJobId, env);
}
