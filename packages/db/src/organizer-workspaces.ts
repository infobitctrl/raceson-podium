import type { AccountContext, RequestSession } from "@raceson/domain/auth";
import { loadAccountContextForAccessToken } from "./account.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireOrganizationAccess } from "./permissions.js";
import {
  createAdminSupabaseClient,
  createUserSupabaseClient,
} from "./supabase.js";

export type OrganizationProfileVisibility = "public" | "members";

export type CreateCurrentUserOrganizerWorkspaceInput = {
  name: string;
  forceCreateNew?: boolean;
  legalName?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
  xUrl?: string | null;
  logoImageUrl?: string | null;
  profileVisibility?: OrganizationProfileVisibility;
  memberDirectoryVisibility?: OrganizationProfileVisibility;
  contactDetailsVisibility?: OrganizationProfileVisibility;
};

export type CreateCurrentUserOrganizerWorkspaceResult = {
  organizationId: string;
  organizationSlug: string;
  workspaceCreated: boolean;
  account: AccountContext;
};

type CreateOrganizerWorkspaceRpcResult = {
  organization_id?: unknown;
  organization_slug?: unknown;
  workspace_created?: unknown;
} | null;

type DatabaseIdentityError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function databaseErrorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as DatabaseIdentityError;
  return [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export const ORGANIZATION_NAME_CONFLICT_MESSAGE =
  "An organization with this name already exists.";

export function isOrganizationNameConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as DatabaseIdentityError;
  if (candidate.code !== "23505") return false;
  return databaseErrorText(error).includes("organizations_name_normalized_unique_idx");
}

function throwMappedOrganizationIdentityError(error: unknown): never {
  if (isOrganizationNameConflict(error)) {
    throw conflict(ORGANIZATION_NAME_CONFLICT_MESSAGE);
  }
  throw error;
}

type OrganizationProfileRow = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  x_url: string | null;
  logo_image_url: string | null;
  profile_visibility: OrganizationProfileVisibility;
  member_directory_visibility: OrganizationProfileVisibility;
  contact_details_visibility: OrganizationProfileVisibility;
  updated_at: string;
};

export type OrganizerWorkspaceProfile = {
  organizationId: string;
  slug: string;
  name: string;
  legalName: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  logoImageUrl: string | null;
  profileVisibility: OrganizationProfileVisibility;
  memberDirectoryVisibility: OrganizationProfileVisibility;
  contactDetailsVisibility: OrganizationProfileVisibility;
  updatedAt: string;
};

export type UpdateOrganizerWorkspaceProfileInput =
  CreateCurrentUserOrganizerWorkspaceInput;

export type DeleteUnusedOrganizerWorkspaceResult = {
  organizationId: string;
  organizationName: string;
  deleted: true;
};

export function mapOrganizerWorkspaceDeletionError(error: unknown) {
  const text = databaseErrorText(error);
  const code = error && typeof error === "object"
    ? (error as DatabaseIdentityError).code
    : null;
  if (
    code === "PGRST202"
    && text.includes("service_delete_unused_organizer_workspace")
  ) {
    return conflict(
      "Organization deletion is temporarily unavailable while the database is being updated. Please try again shortly.",
    );
  }
  if (text.includes("organization_not_found")) {
    return notFound("Organization not found");
  }
  if (text.includes("organization_owner_required")) {
    return forbidden("Only the active organization owner can delete this organization.");
  }
  if (text.includes("organization_deletion_confirmation_mismatch")) {
    return badRequest("Type the exact organization name to confirm deletion.");
  }
  if (text.includes("organization_has_other_team_accounts")) {
    return conflict("Remove every other team account before deleting this organization.");
  }
  if (text.includes("organization_not_empty")) {
    return conflict(
      "This organization has operational data and cannot be deleted. Contact support if it must be retired.",
    );
  }
  if (
    text.includes("organizer_workspace_required")
    || text.includes("organization_deletion_conflict")
  ) {
    return conflict("This organization cannot be deleted in its current state.");
  }
  return null;
}

const ORGANIZATION_PROFILE_COLUMNS =
  "id,slug,name,legal_name,country_code,region,city,description,contact_email,contact_phone,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,logo_image_url,profile_visibility,member_directory_visibility,contact_details_visibility,updated_at";

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function requireOrganizerWorkspaceContacts(
  input: Pick<CreateCurrentUserOrganizerWorkspaceInput, "contactEmail" | "contactPhone">,
) {
  const contactEmail = optionalText(input.contactEmail);
  const contactPhone = optionalText(input.contactPhone);
  if (!contactEmail) {
    throw badRequest("Organization contact email is required.");
  }
  if (!contactPhone) {
    throw badRequest("Organization contact phone is required.");
  }
  return { contactEmail, contactPhone };
}

function profileVisibility(
  value: OrganizationProfileVisibility | null | undefined,
  fallback: OrganizationProfileVisibility,
) {
  return value === "public" || value === "members" ? value : fallback;
}

function mapOrganizationProfile(row: OrganizationProfileRow): OrganizerWorkspaceProfile {
  return {
    organizationId: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
    description: row.description,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    websiteUrl: row.website_url,
    instagramUrl: row.instagram_url,
    facebookUrl: row.facebook_url,
    linkedinUrl: row.linkedin_url,
    youtubeUrl: row.youtube_url,
    tiktokUrl: row.tiktok_url,
    xUrl: row.x_url,
    logoImageUrl: row.logo_image_url,
    profileVisibility: profileVisibility(row.profile_visibility, "public"),
    memberDirectoryVisibility: profileVisibility(
      row.member_directory_visibility,
      "members",
    ),
    contactDetailsVisibility: profileVisibility(
      row.contact_details_visibility,
      "public",
    ),
    updatedAt: row.updated_at,
  };
}

function profilePatch(input: CreateCurrentUserOrganizerWorkspaceInput) {
  return {
    name: input.name.trim(),
    legal_name: optionalText(input.legalName),
    country_code: optionalText(input.countryCode)?.toUpperCase() ?? null,
    region: optionalText(input.region),
    city: optionalText(input.city),
    description: optionalText(input.description),
    contact_email: optionalText(input.contactEmail),
    contact_phone: optionalText(input.contactPhone),
    website_url: optionalText(input.websiteUrl),
    instagram_url: optionalText(input.instagramUrl),
    facebook_url: optionalText(input.facebookUrl),
    linkedin_url: optionalText(input.linkedinUrl),
    youtube_url: optionalText(input.youtubeUrl),
    tiktok_url: optionalText(input.tiktokUrl),
    x_url: optionalText(input.xUrl),
    logo_image_url: optionalText(input.logoImageUrl),
    profile_visibility: profileVisibility(input.profileVisibility, "public"),
    member_directory_visibility: profileVisibility(
      input.memberDirectoryVisibility,
      "members",
    ),
    contact_details_visibility: profileVisibility(
      input.contactDetailsVisibility,
      "public",
    ),
    updated_at: new Date().toISOString(),
  };
}

export async function createCurrentUserOrganizerWorkspace(
  session: RequestSession,
  input: CreateCurrentUserOrganizerWorkspaceInput,
  env: ServerEnv = loadServerEnv(),
): Promise<CreateCurrentUserOrganizerWorkspaceResult> {
  const isPlatformAdminCreatingAdditionalOrganization =
    input.forceCreateNew === true && session.account.isMasterAdmin;

  if (!session.account.organizerSetupEnabled && !isPlatformAdminCreatingAdditionalOrganization) {
    throw forbidden("Enable organizer access in Account before creating an organization.");
  }

  const name = input.name.trim();
  if (name.length < 2) {
    throw badRequest("Organization name must contain at least two characters.");
  }
  requireOrganizerWorkspaceContacts(input);

  const countryCode = input.countryCode?.trim().toUpperCase() || null;
  const userClient = createUserSupabaseClient(session.accessToken, env);
  if (input.forceCreateNew && !session.account.isMasterAdmin) {
    throw forbidden("Only a platform administrator can create an additional organization.");
  }
  const { data, error } = input.forceCreateNew
    ? await userClient.rpc("create_platform_admin_organizer_workspace", {
        workspace_name: name,
        workspace_country_code: countryCode,
      })
    : await userClient.rpc("create_current_user_organizer_workspace", {
        workspace_name: name,
        workspace_country_code: countryCode,
      });

  if (error) {
    throwMappedOrganizationIdentityError(error);
  }

  const payload = (data as CreateOrganizerWorkspaceRpcResult) ?? null;
  const organizationId =
    typeof payload?.organization_id === "string" ? payload.organization_id : null;
  const organizationSlug =
    typeof payload?.organization_slug === "string" ? payload.organization_slug : null;

  if (!organizationId || !organizationSlug) {
    throw new Error("Organization creation did not return the new organization details.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { error: profileError } = await adminClient
    .from("organizations")
    .update(profilePatch(input))
    .eq("id", organizationId);
  if (profileError) throwMappedOrganizationIdentityError(profileError);

  const account = await loadAccountContextForAccessToken(session.accessToken, env);

  return {
    organizationId,
    organizationSlug,
    workspaceCreated: payload?.workspace_created === true,
    account,
  };
}

export async function getOrganizerWorkspaceProfile(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerWorkspaceProfile> {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("organizations")
    .select(ORGANIZATION_PROFILE_COLUMNS)
    .eq("id", organizationId)
    .maybeSingle<OrganizationProfileRow>();
  if (error) throw error;
  if (!data) throw notFound("Organization not found");
  return mapOrganizationProfile(data);
}

export async function updateOrganizerWorkspaceProfile(
  session: RequestSession,
  organizationId: string,
  input: UpdateOrganizerWorkspaceProfileInput,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerWorkspaceProfile> {
  requireOrganizationAccess(session, organizationId, "organization.manage");
  const name = input.name.trim();
  if (name.length < 2) {
    throw badRequest("Organization name must contain at least two characters.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("organizations")
    .update(profilePatch({ ...input, name }))
    .eq("id", organizationId)
    .select(ORGANIZATION_PROFILE_COLUMNS)
    .maybeSingle<OrganizationProfileRow>();
  if (error) throwMappedOrganizationIdentityError(error);
  if (!data) throw notFound("Organization not found");
  return mapOrganizationProfile(data);
}

export async function deleteUnusedOrganizerWorkspace(
  session: RequestSession,
  organizationId: string,
  confirmationName: string,
  env: ServerEnv = loadServerEnv(),
): Promise<DeleteUnusedOrganizerWorkspaceResult> {
  const membership = session.account.organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  if (membership?.role !== "owner") {
    throw forbidden("Only the active organization owner can delete this organization.");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_delete_unused_organizer_workspace",
    {
      p_organization_id: organizationId,
      p_actor_user_id: session.account.userId,
      p_confirmation_name: confirmationName,
    },
  );

  if (error) {
    const mappedError = mapOrganizerWorkspaceDeletionError(error);
    if (mappedError) throw mappedError;
    throw error;
  }

  const result = data as Partial<DeleteUnusedOrganizerWorkspaceResult> | null;
  if (
    result?.organizationId !== organizationId
    || typeof result.organizationName !== "string"
    || result.deleted !== true
  ) {
    throw new Error("Organization deletion did not return the deleted organization details.");
  }

  return result as DeleteUnusedOrganizerWorkspaceResult;
}
