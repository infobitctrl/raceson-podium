import { getSupabasePublicClient } from "@/lib/supabase";
import { getTrackGalleryPreviewImageUrl } from "@/shared/media/eventPreviewImage";

// Cards need the current preview, not the route geometry, results or full gallery.
export async function getPublicTrackPreviewImage(slug: string) {
  const client = getSupabasePublicClient();
  if (!client) return null;
  const { data, error } = await client.from("track_templates")
    .select("gallery_preview_image_url").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return getTrackGalleryPreviewImageUrl(data?.gallery_preview_image_url);
}
