import type { ClubMemberRaceResult } from "./memberResults";

export type PublicClubDetailMember = {
  athleteProfileId: string;
  athleteSlug: string;
  name: string;
  avatarUrl?: string | null;
  ageCategory?: string | null;
  role: string;
  races: number;
  distanceKm: number;
  elevationGainM: number;
  podiums: number;
  wins: number;
  results: ClubMemberRaceResult[];
};

export type PublicClubDetailRace = {
  eventSlug?: string;
  event: string;
  date: string;
  coverImageUrl?: string | null;
  linkedTrackImageUrl?: string | null;
  participants: number;
  bestPlace: number | null;
  bestRunner: string;
};

export type PublicClubDetailLeagueParticipation = {
  leagueSlug: string;
  leagueName: string;
  seasonName: string;
  seasonYear: number;
  imageUrl: string;
  rank: number | null;
  points: number;
  scoredRounds: number;
};

export type PublicClubDetailAnnouncement = {
  title: string;
  date: string;
  desc: string;
};

export type PublicClubDetailBadge = {
  label: string;
  tier: "gold" | "silver" | "bronze" | "default";
};

export type PublicClubDetailReadModel = {
  clubId: string;
  slug: string;
  createdByAthleteProfileId: string | null;
  name: string;
  presidentName: string;
  iconKey: string;
  colorKey: string;
  logoImageUrl: string | null;
  coverImageUrl: string | null;
  foundedYear: number | null;
  mainSport: string | null;
  clubType: string | null;
  officiallyRegistered: boolean;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  trainingDays: string[];
  hasRegularTraining: boolean;
  trainingLocation: string | null;
  trainingNote: string | null;
  privacyLevel: "public" | "private" | "invite_only";
  requiresApproval: boolean;
  region: string;
  city: string;
  members: number;
  totalRaces: number;
  totalDistanceKm: number;
  totalElevationM: number;
  podiums: number;
  wins: number;
  desc: string;
  badges: PublicClubDetailBadge[];
  membersList: PublicClubDetailMember[];
  recentRaces: PublicClubDetailRace[];
  leagueParticipations?: PublicClubDetailLeagueParticipation[];
  topFinishers: PublicClubDetailMember[];
  announcements: PublicClubDetailAnnouncement[];
};

function labelFromSlug(slug: string) {
  const label = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return label || "Trail Club";
}

export function getFallbackPublicClubDetail(slug: string): PublicClubDetailReadModel {
  return {
    clubId: slug,
    slug,
    createdByAthleteProfileId: null,
    name: labelFromSlug(slug),
    presidentName: "",
    iconKey: "mountain",
    colorKey: "primary",
    logoImageUrl: null,
    coverImageUrl: null,
    foundedYear: null,
    mainSport: null,
    clubType: null,
    officiallyRegistered: false,
    websiteUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    contactEmail: null,
    contactPhone: null,
    trainingDays: [],
    hasRegularTraining: false,
    trainingLocation: null,
    trainingNote: null,
    privacyLevel: "public",
    requiresApproval: false,
    region: "Croatia",
    city: "",
    members: 0,
    totalRaces: 0,
    totalDistanceKm: 0,
    totalElevationM: 0,
    podiums: 0,
    wins: 0,
    desc: "",
    badges: [],
    membersList: [],
    recentRaces: [],
    topFinishers: [],
    announcements: [],
  };
}
