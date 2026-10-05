import type { getSupabasePublicClient } from "@/lib/supabase";
import { readPublicBatches } from "@/shared/data/readPublicBatches";
import { getTrackGalleryPreviewImageUrl } from "@/shared/media/eventPreviewImage";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";

type PublicClient = NonNullable<ReturnType<typeof getSupabasePublicClient>>;
export type EventPreviewMedia = {
  coverImageUrl: string | null;
  linkedTrackImageUrl: string | null;
};
export type PublicEventPreviewEdition = { id: string; slug: string; cover_image_url: string | null };

async function readRows<Row>(query: PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Related categories and snapshot history can exceed the provider's row cap
// even with small parent-ID filters. Each caller supplies a stable total order.
async function readPages<Row>(read: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 250) {
    const page = await readRows(read(from, from + 249));
    rows.push(...page);
    if (page.length < 250) return rows;
  }
}

/** Use only edition rows already obtained through the public read boundary.
 * A linked track is a fallback for a missing cover, not a second displayed image.
 */
export async function loadPublicEventPreviewMedia(
  supabase: PublicClient,
  editions: readonly PublicEventPreviewEdition[],
) {
  if (!editions.length) return new Map<string, EventPreviewMedia>();
  const media = new Map(editions.map((edition): [string, EventPreviewMedia] => [edition.slug, {
    coverImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
    linkedTrackImageUrl: null,
  }]));
  const editionIds = [...new Set(editions.filter(edition => !media.get(edition.slug)?.coverImageUrl).map(edition => edition.id))];
  if (!editionIds.length) return media;
  const categories = await readPublicBatches(editionIds, ids => readPages((from, to) => supabase
    .from("event_categories").select("id,event_edition_id")
    .in("event_edition_id", ids).neq("status", "draft").is("organizer_deleted_at", null)
    .order("id", { ascending: true }).range(from, to)));

  const snapshots = await readPublicBatches(categories.map(category => category.id), ids => readPages((from, to) => supabase
    .from("event_category_track_snapshots").select("event_category_id,track_template_id,track_version_id,created_at")
    .in("event_category_id", ids).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)));

  const versionIds = [...new Set(snapshots.map(snapshot => snapshot.track_version_id).filter((id): id is string => Boolean(id)))];
  const versions = await readPublicBatches(versionIds, ids => readRows(supabase
    .from("track_versions").select("id").in("id", ids).not("published_at", "is", null)));
  const publishedVersionIds = new Set(versions.map(version => version.id));
  const latestTemplateIdByCategory = new Map<string, string>();
  // A category belongs to only one batch, so its revisions retain query order.
  for (const snapshot of snapshots) {
    if (snapshot.track_version_id && publishedVersionIds.has(snapshot.track_version_id)
      && !latestTemplateIdByCategory.has(snapshot.event_category_id)) {
      latestTemplateIdByCategory.set(snapshot.event_category_id, snapshot.track_template_id);
    }
  }

  // Superseded/unpublished snapshots cannot supply the selected preview.
  const templates = await readPublicBatches([...new Set(latestTemplateIdByCategory.values())], ids => readRows(supabase
    .from("track_templates").select("id,gallery_preview_image_url").in("id", ids)));
  const imageByTemplateId = new Map(templates.map(template => [template.id, getTrackGalleryPreviewImageUrl(template.gallery_preview_image_url)]));
  const imageByEditionId = new Map<string, string>();
  for (const category of categories) {
    if (imageByEditionId.has(category.event_edition_id)) continue;
    const templateId = latestTemplateIdByCategory.get(category.id);
    const imageUrl = templateId ? imageByTemplateId.get(templateId) : null;
    if (imageUrl) imageByEditionId.set(category.event_edition_id, imageUrl);
  }
  for (const edition of editions) {
    const item = media.get(edition.slug)!;
    item.linkedTrackImageUrl = imageByEditionId.get(edition.id) ?? null;
  }
  return media;
}

export async function loadPublicEventPreviewMediaBySlug(supabase: PublicClient, eventSlugs: string[]) {
  const slugs = [...new Set(eventSlugs.filter(slug => slug.trim().length))];
  const editions = await readPublicBatches(slugs, batch => readRows(supabase
    .from("event_editions").select("id,slug,cover_image_url").in("slug", batch)));
  return loadPublicEventPreviewMedia(supabase, editions);
}
