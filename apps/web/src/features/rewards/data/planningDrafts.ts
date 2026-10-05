import { decodeSavedRewardPlanningDraft, previewRewardProgrammeDraftV2, type SavedRewardPlanningDraft, type RewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

const base = "/v1/organizer/rewards/drafts";
function checked(value: unknown) {
  requirePortal(Boolean(publicEnv.rewardDemo) && publicEnv.rewardPortalEnabled);
  const d = decodeSavedRewardPlanningDraft(value);
  requirePortal(d.chainId === (publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143));
  return d;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString()
    : v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
}
function reply(raw: unknown, id: string) {
  requirePortal(raw && typeof raw === "object" && !Array.isArray(raw));
  const body = raw as Record<string, unknown>;
  requirePortal(Object.keys(body).length === 2 && Object.hasOwn(body, "record") && Object.hasOwn(body, "preview"));
  const record = checked(body.record);
  requirePortal(record.draftId === id && canonical(body.preview) === canonical(previewRewardProgrammeDraftV2(record.rules)));
  return record;
}
export async function listPlanningDrafts(): Promise<SavedRewardPlanningDraft[]> {
  const raw = await apiRequest<{ items: unknown[] }>({ path: base, cache: "no-store" });
  requirePortal(raw && Object.keys(raw).length === 1 && Array.isArray(raw.items) && raw.items.length <= 100);
  return raw.items.map(checked);
}
export async function readPlanningDraft(record: SavedRewardPlanningDraft) {
  const fixed = checked(record);
  return reply(await apiRequest<unknown>({ path: `${base}/${fixed.draftId}`, cache: "no-store" }), fixed.draftId);
}
export async function savePlanningDraft(record: SavedRewardPlanningDraft, rules: RewardProgrammeDraftV2) {
  const fixed = checked(record);
  return reply(await apiRequest<unknown>({ path: `${base}/${fixed.draftId}`, method: "PATCH", cache: "no-store",
    body: { expectedRevision: fixed.revision, rules } }), fixed.draftId);
}
