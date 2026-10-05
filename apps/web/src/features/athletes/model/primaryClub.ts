export type AthleteClubMembershipCandidate = {
  athlete_profile_id: string;
  club_id: string;
  is_primary: boolean;
  membership_origin: string;
  joined_at: string | null;
};

const membershipOriginPriority: Record<string, number> = {
  self_joined: 0,
  admin_added: 1,
  invited: 2,
  represented: 3,
};

function compareMemberships(
  left: AthleteClubMembershipCandidate,
  right: AthleteClubMembershipCandidate,
) {
  if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;

  const originComparison = (membershipOriginPriority[left.membership_origin] ?? 99)
    - (membershipOriginPriority[right.membership_origin] ?? 99);
  if (originComparison !== 0) return originComparison;

  const joinedComparison = String(left.joined_at ?? "").localeCompare(String(right.joined_at ?? ""));
  if (joinedComparison !== 0) return joinedComparison;

  return left.club_id.localeCompare(right.club_id);
}

export function selectPrimaryClubByAthlete(
  memberships: AthleteClubMembershipCandidate[],
) {
  const result = new Map<string, string>();
  for (const membership of [...memberships].sort(compareMemberships)) {
    if (!result.has(membership.athlete_profile_id)) {
      result.set(membership.athlete_profile_id, membership.club_id);
    }
  }
  return result;
}
