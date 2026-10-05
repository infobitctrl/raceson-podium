import { getSupabaseBrowserClient, getSupabasePublicClient } from "@/lib/supabase";
import { mapRaceCourse, type RaceCourse } from "../model/raceCourse";

// The deployed detail bundle omits course_format/lap_count. Read only these
// public course facts when race info opens; never infer laps from route length.
export async function getPublicEventCourses(eventEditionId: string): Promise<RaceCourse[]> {
  const client = getSupabaseBrowserClient() ?? getSupabasePublicClient();
  if (!client || !eventEditionId) return [];
  const { data, error } = await client.from("event_categories")
    .select("id,course_format,lap_count,distance_km")
    .eq("event_edition_id", eventEditionId)
    .neq("status", "draft")
    .neq("results_mode", "informative_age");
  if (error) throw error;
  return (data ?? []).map(mapRaceCourse);
}
