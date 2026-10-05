import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPublishedRaceTrackStart,
  isPublishedRaceTrackResult,
  resolveTrackRecordOccurredAt,
  type TrackRecordCandidate,
  type TrackRecordGender,
} from "@/features/tracks/public/model/trackRecords";

export type TrackSnapshotRecordLink = {
  event_category_id: string;
  track_version_id: string;
  created_at: string | null;
};

export type TrackTemplateSnapshotRecordLink = TrackSnapshotRecordLink & {
  track_template_id: string;
};

export type LinkedTrackRaceEvent = {
  categoryId: string;
  editionId: string;
  slug: string;
  name: string;
  coverImageUrl: string | null;
  startDate: string | null;
  status: string;
};

export type PublishedTrackRaceRecords = {
  candidates: TrackRecordCandidate[];
  primaryEvent: LinkedTrackRaceEvent | null;
  startCount: number;
};

type EventCategoryRow = {
  id: string;
  event_edition_id: string;
};

type EventEditionRow = {
  id: string;
  slug: string;
  name: string;
  cover_image_url: string | null;
  start_date: string | null;
  status: string;
};

type PublicEventParticipantRow = {
  registration_id: string;
  athlete_profile_id: string;
  event_category_id: string;
  athlete_slug: string | null;
  athlete_name: string | null;
  gender: string | null;
  participation_status: string | null;
  result_status: string | null;
  publication_state: string | null;
  finish_time_ms: number | string | null;
};

export const emptyPublishedTrackRaceRecords: PublishedTrackRaceRecords = {
  candidates: [],
  primaryEvent: null,
  startCount: 0,
};

function normalizeGender(value: string | null): TrackRecordGender {
  const normalized = value?.trim().toUpperCase();
  if (normalized?.startsWith("F")) return "F";
  if (normalized?.startsWith("M")) return "M";
  return null;
}

export function selectTrackRaceRecordSnapshots(
  snapshotLinks: TrackSnapshotRecordLink[],
  selectedTrackVersionId?: string | null,
) {
  if (!selectedTrackVersionId) return snapshotLinks;
  return snapshotLinks.filter((snapshot) => snapshot.track_version_id === selectedTrackVersionId);
}

export async function loadPublishedTrackRaceRecordsByTemplate(
  supabase: SupabaseClient,
  snapshotLinks: TrackTemplateSnapshotRecordLink[],
): Promise<Map<string, PublishedTrackRaceRecords>> {
  const templateIds = Array.from(new Set(snapshotLinks.map((snapshot) => snapshot.track_template_id)));
  const recordsByTemplateId = new Map<string, PublishedTrackRaceRecords>(
    templateIds.map((templateId) => [templateId, {
      candidates: [],
      primaryEvent: null,
      startCount: 0,
    }]),
  );
  const categoryIds = Array.from(new Set(snapshotLinks.map((snapshot) => snapshot.event_category_id)));
  if (!categoryIds.length) return recordsByTemplateId;

  const { data: categoryData, error: categoryError } = await supabase
    .from("event_categories")
    .select("id,event_edition_id")
    .in("id", categoryIds);
  if (categoryError) throw categoryError;

  const categories = (categoryData ?? []) as EventCategoryRow[];
  const editionIds = Array.from(new Set(categories.map((category) => category.event_edition_id)));
  if (!editionIds.length) return recordsByTemplateId;

  const { data: editionData, error: editionError } = await supabase
    .from("event_editions")
    .select("id,slug,name,cover_image_url,start_date,status")
    .in("id", editionIds);
  if (editionError) throw editionError;

  const editions = (editionData ?? []) as EventEditionRow[];
  const editionById = new Map(editions.map((edition) => [edition.id, edition]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const snapshotByCategoryId = new Map(snapshotLinks.map((snapshot) => [snapshot.event_category_id, snapshot]));
  const responses = await Promise.all(
    editionIds.map(async (editionId) => ({
      editionId,
      response: await supabase.rpc("public_event_participants", {
        target_event_edition_id: editionId,
      }),
    })),
  );

  const startedRegistrationKeys = new Set<string>();
  for (const { editionId, response } of responses) {
    if (response.error) {
      console.warn("Unable to load one linked race for route records", response.error);
      continue;
    }
    const edition = editionById.get(editionId);
    if (!edition) continue;

    for (const row of (response.data ?? []) as PublicEventParticipantRow[]) {
      const snapshot = snapshotByCategoryId.get(row.event_category_id);
      if (!snapshot) continue;
      const records = recordsByTemplateId.get(snapshot.track_template_id);
      if (!records) continue;
      const elapsedTimeMs = row.finish_time_ms == null ? null : Number(row.finish_time_ms);
      const publishedState = {
        finishTimeMs: elapsedTimeMs,
        participationStatus: row.participation_status,
        resultStatus: row.result_status,
        publicationState: row.publication_state,
      };
      if (isPublishedRaceTrackStart(publishedState)) {
        const registrationKey = `${snapshot.track_template_id}:${row.registration_id}`;
        if (!startedRegistrationKeys.has(registrationKey)) {
          records.startCount += 1;
          startedRegistrationKeys.add(registrationKey);
        }
      }
      if (!isPublishedRaceTrackResult({
        ...publishedState,
      })) continue;

      records.candidates.push({
        id: `race:${row.registration_id}`,
        athleteProfileId: row.athlete_profile_id,
        athleteSlug: row.athlete_slug,
        name: row.athlete_name?.trim() || "Trail Runner",
        elapsedTimeMs: elapsedTimeMs!,
        occurredAt: resolveTrackRecordOccurredAt({
          sourceKind: "race",
          eventStartedAt: edition.start_date,
        }),
        gender: normalizeGender(row.gender),
        sourceKind: "race",
        sourceLabel: edition.name,
        sourceHref: `/events/${edition.slug}`,
      });
    }
  }

  for (const templateId of templateIds) {
    const primarySnapshot = snapshotLinks.find((snapshot) => snapshot.track_template_id === templateId);
    const primaryCategory = primarySnapshot ? categoryById.get(primarySnapshot.event_category_id) : null;
    const primaryEdition = primaryCategory ? editionById.get(primaryCategory.event_edition_id) : null;
    const records = recordsByTemplateId.get(templateId);
    if (!records || !primarySnapshot || !primaryCategory || !primaryEdition) continue;

    records.primaryEvent = {
      categoryId: primarySnapshot.event_category_id,
      editionId: primaryEdition.id,
      slug: primaryEdition.slug,
      name: primaryEdition.name,
      coverImageUrl: primaryEdition.cover_image_url?.trim() || null,
      startDate: primaryEdition.start_date,
      status: primaryEdition.status,
    };
  }

  return recordsByTemplateId;
}

export async function loadPublishedTrackRaceRecords(
  supabase: SupabaseClient,
  snapshotLinks: TrackSnapshotRecordLink[],
): Promise<PublishedTrackRaceRecords> {
  const singleTemplateId = "single-track-template";
  const recordsByTemplateId = await loadPublishedTrackRaceRecordsByTemplate(
    supabase,
    snapshotLinks.map((snapshot) => ({
      ...snapshot,
      track_template_id: singleTemplateId,
    })),
  );

  return recordsByTemplateId.get(singleTemplateId) ?? emptyPublishedTrackRaceRecords;
}
