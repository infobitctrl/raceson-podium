import type {
  AppRole,
  OrganizationAccess,
  OrganizationPermission,
} from "./types.js";

const VALID_APP_ROLES = new Set<AppRole>(["athlete", "organizer", "timer", "sponsor"]);
export const ORGANIZATION_PERMISSIONS = [
  "organization.manage",
  "team.manage",
  "events.manage",
  "entrants.manage",
  "race_day.manage",
  "checkpoint_timing.enter",
  "results.manage",
  "communications.manage",
  "safety.manage",
  "logistics.manage",
  "finance.manage",
] as const satisfies readonly OrganizationPermission[];

const VALID_ORGANIZATION_PERMISSIONS = new Set<OrganizationPermission>(
  ORGANIZATION_PERMISSIONS,
);

const LEGACY_ROLE_PERMISSIONS: Record<string, readonly OrganizationPermission[]> = {
  admin: ORGANIZATION_PERMISSIONS,
  staff: [
    "events.manage",
    "entrants.manage",
    "race_day.manage",
    "results.manage",
  ],
  timer: ["checkpoint_timing.enter"],
};

export function parseAppRole(value: unknown): AppRole | null {
  return typeof value === "string" && VALID_APP_ROLES.has(value as AppRole)
    ? (value as AppRole)
    : null;
}

export function normalizeRequestedRoles(input: readonly unknown[] | null | undefined): AppRole[] {
  const nextRoles = (input ?? [])
    .map((value) => parseAppRole(value))
    .filter((value): value is AppRole => value !== null);

  return nextRoles.length ? Array.from(new Set(nextRoles)) : ["athlete"];
}

export function normalizeOrganizationPermissions(
  input: readonly unknown[] | null | undefined,
): OrganizationPermission[] {
  return Array.from(new Set(
    (input ?? []).filter(
      (value): value is OrganizationPermission =>
        typeof value === "string"
        && VALID_ORGANIZATION_PERMISSIONS.has(value as OrganizationPermission),
    ),
  ));
}

export function effectiveOrganizationPermissions(
  role: string,
  input: readonly unknown[] | null | undefined,
) {
  if (role === "owner" || role === "master_admin") {
    return [...ORGANIZATION_PERMISSIONS];
  }
  const normalized = normalizeOrganizationPermissions(input);
  return normalized.length
    ? normalized
    : [...(LEGACY_ROLE_PERMISSIONS[role] ?? [])];
}

export function summarizeOrganizationAccess(organizations: OrganizationAccess[]) {
  return {
    organizationIds: organizations.map((organization) => organization.organizationId),
    organizationSlugs: organizations.map((organization) => organization.organizationSlug),
    organizationNames: organizations.map((organization) => organization.organizationName),
    organizationRoles: organizations.map((organization) => organization.role),
    hasOrganizerAccess: organizations.length > 0,
  };
}
