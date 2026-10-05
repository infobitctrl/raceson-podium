import { decodeRewardSourceCatalogueV2 } from "./source-mapping-v2.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_finale"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === keys.sort().join(",")); return r;
}
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const label = (v: unknown) => { check(typeof v === "string" && v.trim().length > 0 && v.length <= 512); return v; };
function list(v: unknown, max = 64): unknown[] { check(Array.isArray(v) && v.length <= max); return v; }
function unique(v: string[]) { check(new Set(v).size === v.length); }
function pairs(v: unknown) {
  const result = list(v).map(p => { const r = object(p, ["competitionId", "raceId"]);
    return { competitionId: uuid(r.competitionId), raceId: uuid(r.raceId) }; });
  check(result.length > 0); unique(result.map(r => r.competitionId)); unique(result.map(r => r.raceId));
  return result.sort((a, b) => a.competitionId < b.competitionId ? -1 : 1);
}
export type FinaleBindingChangeV3 = { requestId: string; expectedBindingId: string | null; contextHash: string;
  editionId: string; races: Array<{ competitionId: string; raceId: string }> };
export function decodeFinaleBindingChangeV3(value: unknown): FinaleBindingChangeV3 {
  const r = object(value, ["requestId", "expectedBindingId", "contextHash", "editionId", "races"]);
  return { requestId: uuid(r.requestId), expectedBindingId: r.expectedBindingId === null ? null : uuid(r.expectedBindingId),
    contextHash: hash(r.contextHash), editionId: uuid(r.editionId), races: pairs(r.races) };
}
export function decodeFinaleBindingViewV3(value: unknown) {
  const r = object(value, ["schema", "draftId", "chainId", "recordRevision", "sourceHash", "categories", "editions", "binding", "locked", "contextHash", "recordedId"]);
  check(r.schema === "raceson-finale-binding-v3" && [31337, 10143].includes(r.chainId as number)
    && Number.isSafeInteger(r.recordRevision) && Number(r.recordRevision) > 0 && typeof r.locked === "boolean");
  const categories = decodeRewardSourceCatalogueV2({ rounds: [], categories: r.categories }).categories;
  const editions = list(r.editions, 1000).map(e => {
    const row = object(e, ["id", "name", "date", "races"]), date = label(row.date);
    check(/^\d{4}-\d{2}-\d{2}$/.test(date));
    const races = list(row.races).map(c => { const race = object(c, ["id", "name", "distanceMetres"]);
      check(race.distanceMetres === null || typeof race.distanceMetres === "string" && /^[1-9]\d{0,8}$/.test(race.distanceMetres));
      return { id: uuid(race.id), name: label(race.name), distanceMetres: race.distanceMetres as string | null }; });
    unique(races.map(c => c.id)); return { id: uuid(row.id), name: label(row.name), date, races };
  });
  unique(editions.map(e => e.id));
  let binding = null;
  if (r.binding !== null) {
    const b = object(r.binding, ["id", "previousId", "editionId", "races", "savedAt"]);
    check(typeof b.savedAt === "string" && Number.isFinite(Date.parse(b.savedAt)));
    binding = { id: uuid(b.id), previousId: b.previousId === null ? null : uuid(b.previousId), editionId: uuid(b.editionId),
      races: pairs(b.races), savedAt: b.savedAt };
    // Removed/cancelled editions remain inspectable as a stale binding.
  }
  return { schema: "raceson-finale-binding-v3" as const, draftId: uuid(r.draftId), chainId: r.chainId as 31337 | 10143,
    recordRevision: Number(r.recordRevision), sourceHash: hash(r.sourceHash), categories, editions, binding, locked: r.locked,
    contextHash: hash(r.contextHash), recordedId: r.recordedId === null ? null : uuid(r.recordedId) };
}
export type FinaleBindingViewV3 = ReturnType<typeof decodeFinaleBindingViewV3>;
