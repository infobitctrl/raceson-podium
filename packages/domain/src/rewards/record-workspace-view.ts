import { parseRewardUnits } from "./arithmetic.js";
import { parseRewardSourceTimestamp } from "./source-evidence.js";
import { rewardDistributionUuid as uuid } from "./distribution-view.js";
import type { RewardPreparationSelection } from "./preparation-view.js";

function demand(v: unknown): asserts v { if (!v) throw Error("invalid_reward_record_workspace_document"); }
function object(v: unknown, keys: string[]) {
  demand(v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)));
  const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]));
  return v as Record<string, unknown>;
}
function array<T>(v: unknown, max: number, decode: (v: unknown) => T): T[] {
  demand(Array.isArray(v) && v.length <= max); const fields = Object.getOwnPropertyDescriptors(v);
  demand(!Object.getOwnPropertySymbols(v).length && Object.keys(fields).length === v.length + 1);
  return Array.from({ length: v.length }, (_, i) => { demand(fields[i]?.enumerable && "value" in fields[i]); return decode(fields[i].value); });
}
function label(v: unknown) { demand(v === null || (typeof v === "string" && v.trim() === v && v.length > 0 && [...v].length <= 256)); return v as string | null; }
function integer(v: unknown, max = 20000) { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max); return v; }
function amount(v: unknown) { demand(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v)); parseRewardUnits(v, 0); return v; }
function timestamp(v: unknown) { parseRewardSourceTimestamp(v); return v as string; }
function text(v: unknown) { demand(typeof v === "string" && /^[a-z_]{1,64}$/.test(v)); return v; }
const nullableId = (v: unknown) => v === null ? null : uuid(v);
const baseKeys = ["programmeId", "chainId", "campaignId", "snapshotId"];
export type RewardRecordSelection = RewardPreparationSelection & { snapshotId: string };
function scope(v: Record<string, unknown>, s: RewardRecordSelection) {
  demand((s.chainId === 10143 || s.chainId === 31337) && v.chainId === s.chainId && v.programmeId === uuid(s.programmeId)
    && v.campaignId === uuid(s.campaignId) && v.snapshotId === uuid(s.snapshotId));
  return { programmeId: s.programmeId, campaignId: s.campaignId, chainId: s.chainId, snapshotId: s.snapshotId };
}
export function decodeRewardRecordRacePage(v: unknown, expected: RewardRecordSelection, after: string | null = null) {
  const d = object(v, [...baseKeys, "items", "nextCursor"]), fixed = scope(d, expected); let previous = after;
  const items = array(d.items, 25, v => { const r = object(v, ["raceId", "raceName", "eventEditionId", "eventName", "startAt", "distanceMetres", "latestCaptureId"]);
    const raceId = uuid(r.raceId); demand(previous === null || raceId > previous); previous = raceId;
    return { raceId, raceName: label(r.raceName), eventEditionId: uuid(r.eventEditionId), eventName: label(r.eventName),
      startAt: r.startAt === null ? null : timestamp(r.startAt), distanceMetres: r.distanceMetres === null ? null : amount(r.distanceMetres), latestCaptureId: nullableId(r.latestCaptureId) };
  });
  demand(d.nextCursor === null || (items.length === 25 && uuid(d.nextCursor) === previous));
  return { ...fixed, items, nextCursor: d.nextCursor as string | null };
}
export function decodeRewardRecordCapture(v: unknown, expected: RewardRecordSelection & { priorRaceId: string }) {
  const d = object(v, [...baseKeys, "priorSnapshotId", "priorRaceId", "capturedAt"]);
  demand(d.priorRaceId === uuid(expected.priorRaceId));
  return { ...scope(d, expected), priorSnapshotId: uuid(d.priorSnapshotId), priorRaceId: expected.priorRaceId, capturedAt: timestamp(d.capturedAt) };
}
export function decodeRewardLatestRecordApprovals(v: unknown) {
  const values = array(v, 4, v => { const a = object(v, ["approvalId", "snapshotId", "priorSnapshotId", "raceId", "gender", "revision", "approvedAt", "withdrawnAt"]);
    demand(a.gender === "M" || a.gender === "F"); const revision = integer(a.revision, 2147483646); demand(revision > 0);
    return { approvalId: uuid(a.approvalId), snapshotId: uuid(a.snapshotId), priorSnapshotId: uuid(a.priorSnapshotId), raceId: uuid(a.raceId),
      gender: a.gender, revision, approvedAt: timestamp(a.approvedAt), withdrawnAt: a.withdrawnAt === null ? null : timestamp(a.withdrawnAt) };
  });
  demand(new Set(values.map(v => `${v.raceId}:${v.gender}`)).size === values.length); return values;
}
function race(v: unknown) {
  const r = object(v, ["raceId", "eventEditionId", "startAt", "distanceMetres", "courseFormat", "lapCount", "trackVersionId"]);
  const lapCount = integer(r.lapCount, 10000); demand(lapCount > 0);
  return { raceId: uuid(r.raceId), eventEditionId: uuid(r.eventEditionId), startAt: r.startAt === null ? null : timestamp(r.startAt),
    distanceMetres: amount(r.distanceMetres), courseFormat: text(r.courseFormat), lapCount, trackVersionId: nullableId(r.trackVersionId) };
}
export function decodeRewardRecordWorkspace(v: unknown, expected: RewardRecordSelection, priorId: string | null, after: string | null = null) {
  const d = object(v, [...baseKeys, "allocationId", "targetRaces", "latestApprovals", "prior"]), fixed = scope(d, expected);
  const targetRaces = array(d.targetRaces, 2, race); demand(targetRaces.length === 2 && new Set(targetRaces.map(r => r.raceId)).size === 2);
  const latestApprovals = decodeRewardLatestRecordApprovals(d.latestApprovals); demand(latestApprovals.every(a => targetRaces.some(r => r.raceId === a.raceId)));
  const base = { ...fixed, allocationId: nullableId(d.allocationId), targetRaces, latestApprovals };
  if (d.prior === null) { demand(priorId === null && after === null); return { ...base, prior: null }; }
  const p = object(d.prior, ["priorSnapshotId", "capturedAt", "race", "publicationId", "publishedAt", "runCompletedAt", "resultCount", "openCaseCount", "items", "nextCursor"]);
  demand(p.priorSnapshotId === uuid(priorId)); const priorRace = race(p.race), resultCount = integer(p.resultCount); let previous = after;
  const items = array(p.items, 25, v => { const r = object(v, ["sourceId", "athleteId", "athleteName", "gender", "participationStatus", "resultStatus", "finishTimeMs"]);
    const sourceId = uuid(r.sourceId); demand(previous === null || sourceId > previous); previous = sourceId;
    demand(r.gender === "M" || r.gender === "F" || r.gender === "U");
    return { sourceId, athleteId: nullableId(r.athleteId), athleteName: label(r.athleteName), gender: r.gender,
      participationStatus: text(r.participationStatus), resultStatus: text(r.resultStatus), finishTimeMs: r.finishTimeMs === null ? null : amount(r.finishTimeMs) };
  });
  demand(items.length <= resultCount && (p.nextCursor === null || (items.length === 25 && uuid(p.nextCursor) === previous)));
  if (after === null && p.nextCursor === null) demand(items.length === resultCount);
  return { ...base, prior: { priorSnapshotId: uuid(p.priorSnapshotId), capturedAt: timestamp(p.capturedAt), race: priorRace,
    publicationId: uuid(p.publicationId), publishedAt: timestamp(p.publishedAt), runCompletedAt: timestamp(p.runCompletedAt),
    resultCount, openCaseCount: integer(p.openCaseCount), items, nextCursor: p.nextCursor as string | null } };
}
export type RewardRecordWorkspaceView = ReturnType<typeof decodeRewardRecordWorkspace>;
export type RewardRecordRacePage = ReturnType<typeof decodeRewardRecordRacePage>;
export type RewardRecordDraftReference = { priorSnapshotId: string; targetRaceId: string; baselineSourceId: string; gender: "M" | "F"; expectedRevision: number };
export function decodeRewardRecordPreview(v: unknown, expected: RewardRecordSelection, request: RewardRecordDraftReference) {
  const d = object(v, [...baseKeys, "priorSnapshotId", "targetRaceId", "baselineSourceId", "gender", "expectedRevision", "previewDigest", "baseline", "sourceReviewEndsAtSeconds", "establishmentBasis"]);
  const fixed = scope(d, expected);
  demand(d.priorSnapshotId === uuid(request.priorSnapshotId) && d.targetRaceId === uuid(request.targetRaceId)
    && d.baselineSourceId === uuid(request.baselineSourceId) && d.gender === request.gender && ["M", "F"].includes(request.gender)
    && d.expectedRevision === integer(request.expectedRevision, 2147483645));
  demand(typeof d.previewDigest === "string" && /^[0-9a-f]{64}$/.test(d.previewDigest));
  const b = object(d.baseline, ["publicationId", "establishedAtMs", "finishTimeMs", "courseComparisonKey"]), finishTimeMs = amount(b.finishTimeMs);
  demand(BigInt(finishTimeMs) > 0n && typeof b.courseComparisonKey === "string" && b.courseComparisonKey.length > 0 && b.courseComparisonKey.length <= 200);
  demand(d.establishmentBasis === "gun_finish" || d.establishmentBasis === "result_run_completed_upper_bound");
  return { ...fixed, priorSnapshotId: request.priorSnapshotId, targetRaceId: request.targetRaceId, baselineSourceId: request.baselineSourceId,
    gender: request.gender, expectedRevision: request.expectedRevision, previewDigest: d.previewDigest,
    baseline: { publicationId: uuid(b.publicationId), establishedAtMs: amount(b.establishedAtMs), finishTimeMs, courseComparisonKey: b.courseComparisonKey },
    sourceReviewEndsAtSeconds: amount(d.sourceReviewEndsAtSeconds), establishmentBasis: d.establishmentBasis };
}
export function decodeRewardRecordSaved(v: unknown, expected: RewardRecordSelection, request: RewardRecordDraftReference) {
  const d = object(v, [...baseKeys, "approvalId", "priorSnapshotId", "raceId", "gender", "revision", "approvedAt"]), fixed = scope(d, expected);
  demand(d.priorSnapshotId === uuid(request.priorSnapshotId) && d.raceId === uuid(request.targetRaceId) && d.gender === request.gender
    && d.revision === integer(request.expectedRevision, 2147483645) + 1);
  return { ...fixed, approvalId: uuid(d.approvalId), priorSnapshotId: request.priorSnapshotId, raceId: request.targetRaceId,
    gender: request.gender, revision: integer(d.revision, 2147483646), approvedAt: timestamp(d.approvedAt) };
}
export function decodeRewardRecordWithdrawal(v: unknown, expected: RewardRecordSelection, approvalId: string) {
  const d = object(v, [...baseKeys, "approvalId", "withdrawalId", "withdrawnAt"]), fixed = scope(d, expected);
  demand(d.approvalId === uuid(approvalId));
  return { ...fixed, approvalId, withdrawalId: uuid(d.withdrawalId), withdrawnAt: timestamp(d.withdrawnAt) };
}
export type RewardRecordPreview = ReturnType<typeof decodeRewardRecordPreview>;
