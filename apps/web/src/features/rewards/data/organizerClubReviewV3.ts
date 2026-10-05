import { apiRequest } from "@/lib/api";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
import { decodeClubTreasuryCandidate } from "../model/clubTreasuries";
import { clubEvidenceFields, clubReviewAddress, clubReviewHash, clubReviewReasons, type ClubReviewReason } from "../model/organizerClubs";
import { decodeOrganizerClubReadinessV3, type OrganizerClubSelectionV3, type OrganizerClubReadinessV3 } from "./organizerClubPreparationV3";

function object(raw: unknown, keys: string[]) {
  requirePortal(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  const d = Object.getOwnPropertyDescriptors(raw);
  requirePortal(!Object.getOwnPropertySymbols(raw).length && Object.keys(d).length === keys.length && keys.every(k => d[k] && "value" in d[k]));
  return Object.fromEntries(keys.map(k => [k, d[k].value])) as Record<string, unknown>;
}
const integer = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
function block(raw: unknown) {
  const b = object(raw, ["number", "hash", "timestamp"]);
  requirePortal(integer(b.number) && integer(b.timestamp) && clubReviewHash(b.hash));
  return { number: b.number as string, timestamp: b.timestamp as string, hash: b.hash as `0x${string}` };
}
export type ClubObservationInputV3 = { previousReviewId: string | null; sourceGuardHash: string; identityFingerprint: string;
  factoryAddress: `0x${string}`; deploymentTransactionHash: `0x${string}` };
function observeInput(raw: unknown): ClubObservationInputV3 {
  const r = object(raw, ["previousReviewId", "sourceGuardHash", "identityFingerprint", "factoryAddress", "deploymentTransactionHash"]);
  requirePortal((r.previousReviewId === null || rewardUuid(r.previousReviewId)) && [r.sourceGuardHash,r.identityFingerprint].every(v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v))
    && clubReviewAddress(r.factoryAddress) && clubReviewHash(r.deploymentTransactionHash));
  return r as ClubObservationInputV3;
}
export function clubObservationInputV3(s: OrganizerClubSelectionV3, raw: OrganizerClubReadinessV3, factory: string, transaction: string) {
  const r = decodeOrganizerClubReadinessV3(raw,s);
  requirePortal(r.sourceCurrent && !["source_hold","identity_hold","request_withdrawn"].includes(r.state));
  return observeInput({ previousReviewId: r.reviewId, sourceGuardHash: r.sourceGuardHash, identityFingerprint: r.identityFingerprint,
    factoryAddress: factory, deploymentTransactionHash: transaction });
}
export function decodeClubObservationV3(raw: unknown, s: OrganizerClubSelectionV3, input: ClubObservationInputV3) {
  const expected = observeInput(input), r = object(raw, ["schema","chainId","uploadId","requestId","clubId","slot",...Object.keys(expected),
    "candidate","initializerHash","deploymentBlock","reviewedBlock","scope","executionHistoryReviewRequired"]);
  requirePortal(r.schema === "raceson-club-observation-v3" && r.chainId === s.award.chainId && r.uploadId === s.award.uploadId
    && r.requestId === s.award.requestId && r.clubId === s.clubId && r.slot === s.slot && r.scope === "initialization_only"
    && r.executionHistoryReviewRequired === true && clubReviewHash(r.initializerHash) && Object.entries(expected).every(([k,v]) => r[k] === v));
  const candidate = decodeClubTreasuryCandidate(r.candidate), deployed = block(r.deploymentBlock), reviewed = block(r.reviewedBlock);
  requirePortal(candidate.safeAddress === s.award.recipientAddress && ![candidate.safeAddress,candidate.singletonAddress,candidate.fallbackHandlerAddress].includes(expected.factoryAddress)
    && BigInt(deployed.number) > 0n && BigInt(deployed.number) <= BigInt(reviewed.number) && BigInt(deployed.timestamp) <= BigInt(reviewed.timestamp)
    && (deployed.number !== reviewed.number || deployed.hash === reviewed.hash && deployed.timestamp === reviewed.timestamp));
  return { schema: "raceson-club-observation-v3" as const, uploadId: s.award.uploadId, requestId: s.award.requestId,
    clubId: s.clubId, slot: s.slot, ...expected, chainId: s.award.chainId, candidate, initializerHash: r.initializerHash as `0x${string}`,
    deploymentBlock: deployed, reviewedBlock: reviewed, scope: "initialization_only" as const, executionHistoryReviewRequired: true as const };
}
export type ClubObservationV3 = ReturnType<typeof decodeClubObservationV3>;
const path = (s: OrganizerClubSelectionV3) => {
  requireClaimNetwork(s.award.chainId); requirePortal(rewardUuid(s.award.uploadId) && rewardUuid(s.award.requestId));
  return `/v1/organizer/rewards/uploads/${s.award.uploadId}/club-treasuries/${s.award.requestId}/readiness-v3`;
};
export async function observeOrganizerClubV3(s: OrganizerClubSelectionV3, input: ClubObservationInputV3) {
  const fixed = structuredClone(s), body = observeInput(input);
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/observe`, method: "POST", cache: "no-store", body });
  requireClaimNetwork(fixed.award.chainId); return decodeClubObservationV3(raw,fixed,body);
}
export type ClubEvidenceRefsV3 = Record<typeof clubEvidenceFields[number],string>;
type ReviewBody = ClubObservationInputV3 & { reviewId: string; evidence: unknown };
export type ClubReviewCommandV3 = { selection: OrganizerClubSelectionV3; kind: "review"; body: Omit<ReviewBody,"factoryAddress"|"deploymentTransactionHash"> }
  | { selection: OrganizerClubSelectionV3; kind: "revoke"; body: { reviewId: string; reason: ClubReviewReason } };
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function makeClubReviewCommandV3(selection: OrganizerClubSelectionV3, preview: ClubObservationV3, refs: ClubEvidenceRefsV3, reviewId: string): ClubReviewCommandV3 {
  requireClaimNetwork(selection.award.chainId); requirePortal(rewardUuid(reviewId) && clubEvidenceFields.every(k => rewardUuid(refs[k])));
  const expected = observeInput({ previousReviewId: preview.previousReviewId, sourceGuardHash: preview.sourceGuardHash,
    identityFingerprint: preview.identityFingerprint, factoryAddress: preview.factoryAddress, deploymentTransactionHash: preview.deploymentTransactionHash });
  const p = decodeClubObservationV3(preview,selection,expected);
  return freeze({ selection: structuredClone(selection), kind: "review", body: { reviewId, previousReviewId: p.previousReviewId,
    sourceGuardHash: p.sourceGuardHash, identityFingerprint: p.identityFingerprint, evidence: { schemaVersion: 1,
      policy: "operator-reviewed-original-safe-v1", chainId: p.chainId, candidate: p.candidate, factoryAddress: p.factoryAddress,
      deploymentTransactionHash: p.deploymentTransactionHash, initializerHash: p.initializerHash,
      deploymentBlock: p.deploymentBlock, reviewedBlock: p.reviewedBlock,
      ...Object.fromEntries(clubEvidenceFields.map(k => [k,refs[k]])) } } });
}
export function makeClubRevocationCommandV3(selection: OrganizerClubSelectionV3, raw: OrganizerClubReadinessV3, reason: ClubReviewReason): ClubReviewCommandV3 {
  const r = decodeOrganizerClubReadinessV3(raw,selection);
  requirePortal(r.reviewId && !r.revokedAt && clubReviewReasons.includes(reason));
  return freeze({ selection: structuredClone(selection), kind: "revoke", body: { reviewId: r.reviewId, reason } });
}
export async function saveOrganizerClubReviewV3(command: ClubReviewCommandV3) {
  const c = structuredClone(command);
  const r = object(await apiRequest<unknown>({ path: `${path(c.selection)}${c.kind === "revoke" ? "/revoke" : ""}`,
    method: "POST", cache: "no-store", body: c.body }), ["schema","reviewId","reviewedAt","revokedAt"]);
  requireClaimNetwork(c.selection.award.chainId);
  requirePortal(r.schema === "raceson-club-readiness-record-v3" && r.reviewId === c.body.reviewId
    && typeof r.reviewedAt === "string" && Number.isFinite(Date.parse(r.reviewedAt))
    && (r.revokedAt === null ? c.kind === "review" : typeof r.revokedAt === "string" && Number.isFinite(Date.parse(r.revokedAt)) && Date.parse(r.revokedAt) >= Date.parse(r.reviewedAt)));
  return { reviewId: r.reviewId as string, reviewedAt: r.reviewedAt as string, revokedAt: r.revokedAt as string | null };
}
