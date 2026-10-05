import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicBatches } from "@/shared/data/readPublicBatches";
import { buildCanonicalClubIdBySource, type ClubIdentitySource } from "../model/clubIdentity";
import { readClubPages } from "./readClubPages";

const CLUB_FIELDS = "id,slug,status,created_by_athlete_profile_id,name,president_name,icon_key,color_key,logo_image_url,cover_image_url,privacy_level,requires_approval,region,city,country_code,description,founded_year,main_sport,club_type,officially_registered,website_url,instagram_url,facebook_url,contact_email,contact_phone,training_days,has_regular_training,training_location,training_note";

function missingMergeColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  return (code === "42703" || code === "PGRST204") && Boolean(message?.includes("merged_into_club_id"));
}

/** Read the requested identity and follow only its merge chain. RLS still governs every read. */
async function readPublicClubIdentity(supabase: SupabaseClient, slug: string) {
  let key = "slug";
  let value = slug;
  let supportsMerges = true;
  const visited = new Set<string>();
  while (true) {
    let response = await supabase.from("clubs")
      .select(`${CLUB_FIELDS},merged_into_club_id`).eq(key, value).maybeSingle();
    if (response.error && missingMergeColumn(response.error)) {
      supportsMerges = false;
      response = await supabase.from("clubs").select(CLUB_FIELDS).eq(key, value).maybeSingle();
    }
    if (response.error) throw response.error;
    const club = response.data;
    if (!club || visited.has(club.id)) return null;
    visited.add(club.id);
    const nextId = typeof club.merged_into_club_id === "string" ? club.merged_into_club_id : null;
    if (supportsMerges && nextId) {
      key = "id";
      value = nextId;
      continue;
    }
    return club.status === "active" ? { club, supportsMerges } : null;
  }
}

type IdentityRead = ReturnType<typeof readPublicClubIdentity>;
const pendingIdentities = new WeakMap<SupabaseClient, Map<string, IdentityRead>>();

/** The hero and detail queries share concurrent identity reads, never settled/stale data. */
export function resolvePublicClub(supabase: SupabaseClient, slug: string): IdentityRead {
  let pending = pendingIdentities.get(supabase);
  if (!pending) {
    pending = new Map();
    pendingIdentities.set(supabase, pending);
  }
  const existing = pending.get(slug);
  if (existing) return existing;
  const request = readPublicClubIdentity(supabase, slug).then(
    value => { pending.delete(slug); return value; },
    error => { pending.delete(slug); throw error; },
  );
  pending.set(slug, request);
  return request;
}

/** Walk reverse merge edges rather than downloading every club on each profile visit. */
export async function readPublicClubFamily(supabase: SupabaseClient, clubId: string, supportsMerges: boolean) {
  const identities: ClubIdentitySource[] = [{ id: clubId, merged_into_club_id: null }];
  const seen = new Set([clubId]);
  let frontier = supportsMerges ? [clubId] : [];
  while (frontier.length) {
    const children = await readPublicBatches(frontier, ids => readClubPages(async (from, to) =>
      supabase.from("clubs").select("id,merged_into_club_id")
        .in("merged_into_club_id", ids).order("id", { ascending: true }).range(from, to),
    ));
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      identities.push(child);
      frontier.push(child.id);
    }
  }
  return { clubFamilyIds: [...seen], canonicalClubIdBySource: buildCanonicalClubIdBySource(identities) };
}
