import type {
  AccountTypeSelection,
  AuthAccountContext,
} from "@/lib/auth";

export function accountTypeSelectionForAccount(
  account: AuthAccountContext | null,
): AccountTypeSelection {
  const roles = account?.requestedRoles ?? [];
  const hasAthlete = roles.includes("athlete") || (!roles.length && Boolean(account?.hasAthleteAccess));
  const hasOrganizer =
    roles.includes("organizer")
    || roles.includes("timer")
    || (!roles.length && Boolean(account?.organizerSetupEnabled || account?.hasOrganizerAccess));

  if (hasAthlete && hasOrganizer) return "athlete-organizer";
  if (hasOrganizer) return "organizer";
  return "athlete";
}
