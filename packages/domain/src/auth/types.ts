export type AppRole = "athlete" | "organizer" | "timer" | "sponsor";
export type PlatformRole = "super_admin" | "site_admin";
export type PlatformTestingRole = "test_admin" | "test_timer" | "test_organizer";
export type AthleteGender = "F" | "M" | "U";
export type OrganizationMembershipType = "permanent" | "temporary";
export type OrganizationPermission =
  | "organization.manage"
  | "team.manage"
  | "events.manage"
  | "entrants.manage"
  | "race_day.manage"
  | "checkpoint_timing.enter"
  | "results.manage"
  | "communications.manage"
  | "safety.manage"
  | "logistics.manage"
  | "finance.manage";

export type OrganizationAccess = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  organizationKind: "organizer" | "club";
  linkedClubId: string | null;
  linkedClubSlug: string | null;
  linkedClubName: string | null;
  role: string;
  membershipType: OrganizationMembershipType;
  loginUsername: string | null;
  permissions: OrganizationPermission[];
  expiresAt: string | null;
};

export type EventAccess = {
  assignmentId: string;
  eventEditionId: string;
  organizationId: string;
  eventCategoryId: string | null;
  checkpointId: string | null;
  roleTitle: string;
  permissions: OrganizationPermission[];
  startsAt: string;
  endsAt: string;
};

export type AccountContext = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  authProviders: string[];
  requestedRoles: AppRole[];
  organizerSetupEnabled: boolean;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: AthleteGender | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  jobTitle: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  shirtSize: string | null;
  mealPreference?: string | null;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  defaultRole: AppRole | null;
  primaryAthleteProfileId: string | null;
  primaryAthleteSlug: string | null;
  organizationIds: string[];
  organizationSlugs: string[];
  organizationNames: string[];
  organizationRoles: string[];
  organizations: OrganizationAccess[];
  eventAccess: EventAccess[];
  isMasterAdmin: boolean;
  platformRole: PlatformRole | null;
  canManagePlatformAdmins: boolean;
  testingRole: PlatformTestingRole | null;
  hasTestingAccess: boolean;
  accountType: "master_admin" | "testing" | "owner" | "permanent" | "temporary" | "athlete";
  loginUsername: string | null;
  usernameChangeAvailableAt: string | null;
  hasAthleteAccess: boolean;
  hasOrganizerAccess: boolean;
};

export type BootstrapCurrentUserAccountInput = {
  roles: AppRole[];
  displayName: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  gender?: AthleteGender | null;
  phone?: string | null;
  shirtSize?: string | null;
  locale?: string;
  timezone?: string;
  createAthleteProfile?: boolean;
};

export type RequestSession = {
  accessToken: string;
  account: AccountContext;
};
