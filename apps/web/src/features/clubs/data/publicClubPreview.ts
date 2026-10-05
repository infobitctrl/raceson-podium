import { getSupabasePublicClient } from "@/lib/supabase";
import { countryName as countryLabel } from "@/shared/domain/countries";
import { getFallbackPublicClubDetail, type PublicClubDetailReadModel } from "../model/publicClubDetail";
import { resolvePublicClub } from "./publicClubIdentity";

export async function getPublicClubPreview(slug: string): Promise<PublicClubDetailReadModel | null> {
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Public club data is unavailable.");
  const identity = await resolvePublicClub(supabase, slug);
  if (!identity) return null;
  const { club } = identity;
  const fallback = getFallbackPublicClubDetail(club.slug || slug);
  return {
    ...fallback,
    clubId: typeof club.id === "string" ? club.id : fallback.clubId,
    slug: typeof club.slug === "string" ? club.slug : fallback.slug,
    createdByAthleteProfileId:
      typeof club.created_by_athlete_profile_id === "string"
        ? club.created_by_athlete_profile_id
        : null,
    name: typeof club.name === "string" && club.name.trim() ? club.name : fallback.name,
    presidentName: typeof club.president_name === "string" ? club.president_name.trim() : "",
    iconKey: typeof club.icon_key === "string" ? club.icon_key : fallback.iconKey,
    colorKey: typeof club.color_key === "string" ? club.color_key : fallback.colorKey,
    logoImageUrl: typeof club.logo_image_url === "string" ? club.logo_image_url : null,
    coverImageUrl: typeof club.cover_image_url === "string" ? club.cover_image_url : null,
    privacyLevel:
      club.privacy_level === "private" || club.privacy_level === "invite_only"
        ? club.privacy_level
        : "public",
    requiresApproval: Boolean(club.requires_approval),
    region:
      typeof club.region === "string" && club.region.trim()
        ? club.region
        : countryLabel(club.country_code),
    city: typeof club.city === "string" ? club.city : "",
    desc: typeof club.description === "string" ? club.description : "",
    trainingDays: Array.isArray(club.training_days)
      ? club.training_days.filter((day): day is string => typeof day === "string")
      : [],
    hasRegularTraining: Boolean(club.has_regular_training),
    trainingLocation: typeof club.training_location === "string" ? club.training_location : null,
    trainingNote: typeof club.training_note === "string" ? club.training_note : null,
  };
}
