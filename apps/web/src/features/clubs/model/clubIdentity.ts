export type ClubIdentitySource = {
  id: string;
  merged_into_club_id: string | null;
};

export type CurrentClubMembershipSource = {
  club_id: string;
  athlete_profile_id: string;
  status?: string;
  membership_origin: string;
  is_primary: boolean;
  joined_at: string | null;
};

export function buildCanonicalClubIdBySource(clubs: ClubIdentitySource[]) {
  const directCanonicalId = new Map(
    clubs
      .filter((club) => club.merged_into_club_id)
      .map((club) => [club.id, club.merged_into_club_id!] as const),
  );
  const canonicalClubIdBySource = new Map<string, string>();

  for (const club of clubs) {
    const visited = new Set<string>();
    let currentClubId = club.id;

    while (directCanonicalId.has(currentClubId) && !visited.has(currentClubId)) {
      visited.add(currentClubId);
      currentClubId = directCanonicalId.get(currentClubId)!;
    }

    canonicalClubIdBySource.set(
      club.id,
      visited.has(currentClubId) ? club.id : currentClubId,
    );
  }

  return canonicalClubIdBySource;
}

export function canonicalClubId(
  clubId: string,
  canonicalClubIdBySource: ReadonlyMap<string, string>,
) {
  return canonicalClubIdBySource.get(clubId) ?? clubId;
}

function membershipPriority(
  membership: CurrentClubMembershipSource,
  resolvedClubId: string,
) {
  return [
    membership.is_primary ? 0 : 1,
    membership.club_id === resolvedClubId ? 0 : 1,
    membership.joined_at ?? "9999-12-31T23:59:59Z",
    membership.club_id,
  ] as const;
}

function compareMembershipPriority(
  left: CurrentClubMembershipSource,
  right: CurrentClubMembershipSource,
  resolvedClubId: string,
) {
  const leftPriority = membershipPriority(left, resolvedClubId);
  const rightPriority = membershipPriority(right, resolvedClubId);

  for (let index = 0; index < leftPriority.length; index += 1) {
    const comparison = String(leftPriority[index]).localeCompare(String(rightPriority[index]));
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function selectCurrentClubMemberships<
  TMembership extends CurrentClubMembershipSource,
>(
  memberships: TMembership[],
  canonicalClubIdBySource: ReadonlyMap<string, string>,
  options: { includeRepresented?: boolean } = {},
) {
  const selectedByClubAndAthlete = new Map<string, TMembership & { club_id: string }>();

  for (const membership of memberships) {
    if (membership.status && membership.status !== "active") continue;
    if (membership.membership_origin === "represented" && !options.includeRepresented) continue;

    const resolvedClubId = canonicalClubId(membership.club_id, canonicalClubIdBySource);
    const key = `${resolvedClubId}:${membership.athlete_profile_id}`;
    const current = selectedByClubAndAthlete.get(key);

    if (
      !current
      || compareMembershipPriority(membership, current, resolvedClubId) < 0
    ) {
      selectedByClubAndAthlete.set(key, { ...membership, club_id: resolvedClubId });
    }
  }

  return Array.from(selectedByClubAndAthlete.values());
}
