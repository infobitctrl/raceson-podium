import { z } from "zod";
import { finalPublicationFactsV3, allocationDocumentHashV3, RewardLedgerStoreError, rewardDocumentUuid as uuid,
  copyRewardLedgerDocument as copy, type FinalPublicationScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { buildFinalPublicationEvidenceV3 } from "@raceson/domain/rewards/final-publication-v3";
import { decodeFinalPublicationViewV3 } from "@raceson/domain/rewards/final-publication-view-v3";
import { inspectNativeFinaleSourceV3 } from "@raceson/domain/rewards/native-finale-source-v3";
import { canonicalRewardJson } from "@raceson/rewards-chain";
type Facts = Awaited<ReturnType<typeof finalPublicationFactsV3>>;
const check = (v: unknown, code: string): void => { if (!v) throw new RewardLedgerStoreError(code); };
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const finalPublicationChangeV3 = z.object({ requestId: z.string().uuid(), contextHash: digest, packageHash: digest, evidenceHash: digest }).strict();
function current(f: Facts) { return f.upload.current && f.registry.context.intent?.current === true; }
export function composeFinalPublicationEvidenceV3(f: Facts) {
  check(current(f), "reward_final_publication_not_ready");
  const u = f.upload, n = f.source.policy.facts.native, d = u.document;
  check(inspectNativeFinaleSourceV3(n).state === "final_source_observed" && u.prepared, "reward_final_publication_not_ready");
  return buildFinalPublicationEvidenceV3({ chainId: d.record.chainId, draftId: d.record.draftId, slot: d.slot, approvalId: u.approvalId,
    uploadId: u.prepared!.id, contextHash: u.contextHash, documentHash: u.documentHash, packageHash: u.prepared!.packageHash, sourceReview: d.sourceReview,
    reviewPeriod: String(d.binding!.reviewSeconds), finalRoundReviewPeriod: String(f.registry.context.intent!.terms.reviewPeriods[4]),
    nativeRaces: n.document.races.map(r => ({ raceId: r.raceId, competitionId: r.competitionId, policyId: r.review.policyId,
      reviewSeconds: String(r.review.reviewSeconds), configuredAt: r.review.configuredAt, startedByPublicationId: r.review.startedByPublicationId,
      startedAt: r.review.startedAt, endsAt: r.review.endsAt, finalPublicationId: r.review.finalPublicationId, officialPublishedAt: r.review.officialPublishedAt })) });
}
function project(f: Facts, acknowledged: boolean) {
  let evidence = null;
  const reasons: string[] = [];
  try { evidence = composeFinalPublicationEvidenceV3(f); }
  catch (e) { const code = e instanceof Error ? e.message : "";
    if (!["reward_final_publication_not_ready", "reward_final_review_policy_mismatch"].includes(code)) throw e;
    reasons.push(code); }
  if (f.publication && evidence) check(canonicalRewardJson(f.publication.document) === canonicalRewardJson(evidence), "reward_planning_revision_changed");
  return decodeFinalPublicationViewV3(copy({ schema: "raceson-final-publication-view-v3", chainId: f.upload.document.record.chainId, draftId: f.upload.document.record.draftId,
    slot: f.upload.document.slot, approvalId: f.upload.approvalId, uploadId: f.upload.prepared!.id, contextHash: f.upload.contextHash,
    packageHash: f.upload.prepared!.packageHash, evidenceHash: evidence ? allocationDocumentHashV3(evidence) : null, current: current(f), reasons,
    timing: evidence ? { clockKind: evidence.clockKind, reviewPeriod: evidence.reviewPeriod, finalRoundReviewPeriod: evidence.finalRoundReviewPeriod,
      reviewStartedAt: evidence.reviewStartedAt, officialPublishedAt: evidence.officialPublishedAt, nativeRaceCount: evidence.nativeRaces.length } : null,
    publication: f.publication ? { id: f.publication.id, contextHash: f.publication.contextHash, evidenceHash: f.publication.evidenceHash,
      recordedAt: f.publication.recordedAt, binding: f.publication.binding } : null,
    historicalAcknowledgement: acknowledged, publicationBound: f.publication !== null && evidence !== null,
    stageReady: false, payableWei: "0" }), { chainId: f.upload.document.record.chainId, draftId: f.upload.document.record.draftId,
    slot: f.upload.document.slot, approvalId: f.upload.approvalId, uploadId: f.upload.prepared!.id });
}
/** Explicit aggregate attestation only. Does not publish sporting results,
 * start a timer, sign, send, activate or turn an unclaimed profile into a wallet. */
export async function finalPublicationV3(identity: RewardAccountIdentity, input: FinalPublicationScopeV3,
  change?: z.infer<typeof finalPublicationChangeV3>, rpc?: RewardLedgerRpc) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, scope = { ...input };
  const c = change && finalPublicationChangeV3.parse(change);
  let f = await finalPublicationFactsV3(actor, scope, undefined, rpc);
  if (!c) return project(f, false);
  const evidence = f.publication?.document ?? composeFinalPublicationEvidenceV3(f);
  check((!f.publication || f.publication.id === c.requestId) && evidence.contextHash === c.contextHash
    && evidence.packageHash === c.packageHash && allocationDocumentHashV3(evidence) === c.evidenceHash, "reward_final_publication_conflict");
  f = await finalPublicationFactsV3(actor, scope, { requestId: c.requestId, contextHash: c.contextHash, packageHash: c.packageHash, document: evidence }, rpc);
  return project(f, true);
}
