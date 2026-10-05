import { getSupabasePublicClient } from "@/lib/supabase";

/** Read only public identity images; private profile fields are never requested. */
export async function getWorkspaceAvatars(kind: "club" | "organizer", ids: string[]) {
  if (!ids.length) return {} as Record<string, string | null>;
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Workspace images are unavailable.");
  const key = kind === "club" ? "slug" : "id";
  const query = kind === "club"
    ? supabase.from("clubs").select("slug,logo_image_url").in("slug", ids)
    : supabase.from("public_organization_profiles").select("id,logo_image_url").in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row: Record<string, unknown>) => [
    String(row[key]),
    typeof row.logo_image_url === "string" ? row.logo_image_url : null,
  ])) as Record<string, string | null>;
}
