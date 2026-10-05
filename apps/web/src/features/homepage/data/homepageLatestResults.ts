import { apiRequest, resolveApiUrl } from "@/lib/api";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import { normalizePublicResultClubName } from "@/features/results/public/model/publicResultPresentation";
import { formatSexClassificationLabel } from "@/shared/domain/competitiveClassification";

type PublicationState = "provisional" | "official" | "corrected";
type ResultGender = "F" | "M" | "U";

type PublicRaceSummaryContract = {
  slug: string;
  name: string;
  startDate: string;
  coverImageUrl: string | null;
  organizerName?: string | null;
  latestResultState: PublicationState | null;
};

type PublicRaceDirectoryContract = {
  races: PublicRaceSummaryContract[];
};

type PublicResultRowContract = {
  name: string;
  athleteSlug: string | null;
  clubName: string | null;
  gender: ResultGender;
  ageCategoryLabel: string | null;
  participationStatus: string;
  resultStatus: string;
  finishTimeMs: number | null;
  rankOverall: number | null;
  rankGender: number | null;
  rankAgeCategory: number | null;
};

type PublicResultCategoryContract = {
  id: string;
  slug: string;
  name: string;
  classifications?: Array<{
    id: string;
    label: string;
    gender: "F" | "M" | null;
    minimumAge: number | null;
    maximumAge: number | null;
  }>;
  publicationState: PublicationState;
  publishedAt: string;
  rows: PublicResultRowContract[];
};

type PublicRaceResultsContract = {
  slug: string;
  name: string;
  categories: PublicResultCategoryContract[];
};

type PublicRaceResultsResponse = {
  results: PublicRaceResultsContract;
};

export type HomepageResultEntry = {
  place: number;
  genderRank: number | null;
  ageCategoryRank: number | null;
  ageCategoryLabel: string | null;
  name: string;
  athleteSlug: string | null;
  club: string;
  time: string;
  gender: ResultGender;
};

export type HomepageResultCategory = {
  id: string;
  slug: string;
  name: string;
  classifications: HomepageResultClassification[];
  publicationState: PublicationState;
  publishedAt: string;
  entries: HomepageResultEntry[];
};

export type HomepageResultClassification = {
  id: string;
  label: string;
  gender: "F" | "M" | null;
  minimumAge: number | null;
  maximumAge: number | null;
};

export type HomepageResultItem = {
  event: string;
  eventSlug: string;
  eventDate: string;
  eventImageUrl: string | null;
  categories: HomepageResultCategory[];
};

function formatElapsedTime(finishTimeMs: number) {
  const totalSeconds = Math.max(0, Math.floor(finishTimeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function resolvePublicRaceCoverUrl(value: string | null | undefined) {
  const coverImageUrl = value?.trim();
  if (!coverImageUrl) return null;
  return coverImageUrl.startsWith("/api/")
    ? resolveApiUrl(coverImageUrl.slice("/api".length))
    : resolveRecoveredPublicMediaUrl(coverImageUrl);
}

function mapCategory(category: PublicResultCategoryContract): HomepageResultCategory | null {
  const entries = category.rows
    .filter((row) => (
      row.participationStatus === "finished"
      && row.resultStatus !== "void"
      && row.resultStatus !== "uncomputed"
      && row.finishTimeMs != null
      && row.rankOverall != null
      && row.rankOverall > 0
    ))
    .sort((left, right) => (
      (left.rankOverall ?? Number.MAX_SAFE_INTEGER) - (right.rankOverall ?? Number.MAX_SAFE_INTEGER)
      || (left.finishTimeMs ?? Number.MAX_SAFE_INTEGER) - (right.finishTimeMs ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name)
    ))
    .slice(0, 100)
    .map((row) => ({
      place: row.rankOverall as number,
      genderRank: row.rankGender && row.rankGender > 0 ? row.rankGender : null,
      ageCategoryRank: row.rankAgeCategory && row.rankAgeCategory > 0 ? row.rankAgeCategory : null,
      ageCategoryLabel: row.ageCategoryLabel?.trim() || null,
      name: row.name,
      athleteSlug: row.athleteSlug,
      club: normalizePublicResultClubName(row.clubName),
      time: formatElapsedTime(row.finishTimeMs as number),
      gender: row.gender,
    }));

  if (entries.length === 0) return null;

  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    classifications: (category.classifications ?? []).map((classification) => ({
      ...classification,
      label: formatSexClassificationLabel(classification.label),
    })),
    publicationState: category.publicationState,
    publishedAt: category.publishedAt,
    entries,
  };
}

async function getRaceResult(summary: PublicRaceSummaryContract): Promise<HomepageResultItem | null> {
  try {
    const payload = await apiRequest<PublicRaceResultsResponse>({
      path: `/v1/public/races/${encodeURIComponent(summary.slug)}/results?rowLimit=100`,
      accessToken: null,
    });
    const categories = payload.results.categories.flatMap((category) => {
      const mapped = mapCategory(category);
      return mapped ? [mapped] : [];
    });

    if (categories.length === 0) return null;

    return {
      event: payload.results.name || summary.name,
      eventSlug: payload.results.slug || summary.slug,
      eventDate: summary.startDate,
      eventImageUrl: resolvePublicRaceCoverUrl(summary.coverImageUrl),
      categories,
    };
  } catch (error) {
    console.warn(`Unable to load homepage results for ${summary.slug}`, error);
    return null;
  }
}

export async function getHomepageLatestResults(): Promise<HomepageResultItem[]> {
  try {
    const directory = await apiRequest<PublicRaceDirectoryContract>({
      path: "/v1/public/races",
      accessToken: null,
    });
    const latestPublishedRaces = directory.races
      .filter((race) => race.latestResultState !== null)
      .sort((left, right) => (
        right.startDate.localeCompare(left.startDate)
        || left.slug.localeCompare(right.slug)
      ))
      .slice(0, 2);

    const results = await Promise.all(latestPublishedRaces.map(getRaceResult));
    return results.flatMap((result) => result ? [result] : []);
  } catch (error) {
    console.warn("Unable to load homepage latest results", error);
    return [];
  }
}
