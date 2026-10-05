import { readProgrammeLifecycleV3, reserveProgrammeLifecycleV3, storeProgrammeLifecycleAttemptV3, decodeProgrammeLifecycleBodyV3,
  rewardDocumentUuid as uuid, type ProgrammeLifecycleScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson, readRewardPendingNonce, type RewardNonceReader } from "@raceson/rewards-chain";
import { decodeRewardProgrammeUploadV3, normalizeRewardProgrammeLifecycleV3, readRewardProgrammeLifecyclePrestateV3,
  verifySignedRewardProgrammeLifecycleV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import type { Hex } from "viem";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { composeApprovedAllocationUploadV3 } from "./allocation-upload-v3-service.js";
import { allocationApprovalReasonsV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { finalAllocationReasonsV3 } from "@raceson/domain/rewards/final-allocation-document-v3";

type Context = Awaited<ReturnType<typeof readProgrammeLifecycleV3>>;
const same = (a: unknown, b: unknown) => canonicalRewardJson(a) === canonicalRewardJson(b);
function capture(identity: RewardAccountIdentity, input: ProgrammeLifecycleScopeV3) {
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, scope: {
    chainId: input.chainId, draftId: uuid(input.draftId), slot: input.slot, approvalId: uuid(input.approvalId),
    uploadId: uuid(input.uploadId), intentId: uuid(input.intentId) } };
}
function source(context: Context) {
  const { registry: r, upload: u } = context;
  requireReward(r.registry && r.context.intent && u.prepared, "reward_programme_not_verified");
  const programme = { ...programmeDeploymentPlanV3(r.context), deploymentTransactionHash: r.registry.provenance.transactionHash };
  requireReward(programme.context.verifyingContract.toLowerCase() === r.registry.provenance.contractAddress
    && programme.programmeId === r.registry.provenance.programmeId && programme.programmeManifestHash === r.registry.provenance.programmeManifestHash,
  "reward_programme_not_verified");
  const upload = decodeRewardProgrammeUploadV3(programme, u.document.slot - 1, u.prepared.package);
  const d = u.document;
  const final = d.schema === "raceson-allocation-document-v3.2";
  requireReward((final ? finalAllocationReasonsV3(d) : allocationApprovalReasonsV3(d)).length === 0,
    "invalid_reward_allocation_upload");
  requireReward(same(composeApprovedAllocationUploadV3(u, final ? d.enabledPot : 0), upload), "invalid_reward_allocation_upload");
  return { programme, slot: u.document.slot - 1, upload, current: r.context.intent.current && u.current };
}
export function programmeLifecyclePlanV3(context: Context) {
  const s = source(context), i = context.intent;
  requireReward(i, "reward_programme_lifecycle_required");
  const b = i.body, common = { protocolVersion: 3 as const, programme: s.programme, slot: s.slot, upload: s.upload, nonce: i.nonce, fees: b.fees };
  return lifecyclePlan(common, b);
}
function lifecyclePlan(common: Pick<Parameters<typeof normalizeRewardProgrammeLifecycleV3>[0], "protocolVersion" | "programme" | "slot" | "upload" | "nonce" | "fees">,
  b: ReturnType<typeof decodeProgrammeLifecycleBodyV3>) {
  if (b.action === "complete_funding") return normalizeRewardProgrammeLifecycleV3({ ...common, action: b.action });
  if (b.action === "upload_awards") return normalizeRewardProgrammeLifecycleV3({ ...common, action: b.action, batchStart: b.batchStart, batchSize: b.batchSize });
  const { reviewPeriod, reviewStartedAt, officialPublishedAt, publicationEvidenceHash } = b.publication;
  return normalizeRewardProgrammeLifecycleV3({ ...common, action: b.action, publication: { reviewPeriod, reviewStartedAt, officialPublishedAt, publicationEvidenceHash } });
}

/** Private reservation result. No signing, sending or clock fabrication. HTTP
 * composition must whitelist metadata, never return this private plan. The
 * worker must require confirmed predecessors and arm fresh. */
export async function prepareProgrammeLifecycleV3(identity: RewardAccountIdentity, input: ProgrammeLifecycleScopeV3 & {
  predecessorId: string | null; body: unknown }, dependencies: { reader: RewardProgrammeReaderV3 & RewardNonceReader; rpc?: RewardLedgerRpc }) {
  const { actor, scope } = capture(identity, input), predecessorId = input.predecessorId === null ? null : uuid(input.predecessorId);
  const body = JSON.parse(canonicalRewardJson(input.body)) as unknown, b = decodeProgrammeLifecycleBodyV3(body);
  const { reader, rpc } = dependencies;
  const before = await readProgrammeLifecycleV3(actor, scope, rpc), s = source(before);
  requireReward(b.packageHash === before.upload.prepared!.packageHash, "reward_programme_lifecycle_conflict");
  let pendingNonce = 0n;
  if (!before.intent) {
    requireReward(s.current, "reward_allocation_not_ready");
    pendingNonce = await readRewardPendingNonce(reader, s.programme.context, s.programme.operatorAddress);
    const common = { protocolVersion: 3 as const, programme: s.programme, slot: s.slot, upload: s.upload,
      nonce: pendingNonce > s.programme.deploymentNonce ? pendingNonce : s.programme.deploymentNonce + 1n, fees: b.fees };
    await readRewardProgrammeLifecyclePrestateV3(reader, lifecyclePlan(common, b));
  }
  // SQL takes the shared nonce lock, then authority/draft locks, and checks the
  // current immutable source after all chain IO. An old exact retry keeps nonce.
  const saved = await reserveProgrammeLifecycleV3(actor, scope, { predecessorId, pendingNonce, body }, rpc);
  return { status: source(saved).current ? "reserved" as const : "held" as const, intentId: scope.intentId,
    predecessorId: saved.intent!.predecessorId, plan: programmeLifecyclePlanV3(saved) };
}
const storageBody = (v: Awaited<ReturnType<typeof verifySignedRewardProgrammeLifecycleV3>>) => ({
  ...v, operatorAddress: v.operatorAddress.toLowerCase(), contractAddress: v.contractAddress.toLowerCase() });

/** Private signed-attempt recording. Exactly one byte sequence per intent. */
export async function recordSignedProgrammeLifecycleV3(identity: RewardAccountIdentity,
  input: ProgrammeLifecycleScopeV3 & { attemptId: string; signedTransaction: Hex }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId), signedTransaction = input.signedTransaction;
  const saved = await readProgrammeLifecycleV3(actor, scope, rpc), s = source(saved);
  requireReward(saved.intent, "reward_programme_lifecycle_required");
  requireReward(saved.attempt || s.current, "reward_allocation_not_ready");
  const body = storageBody(await verifySignedRewardProgrammeLifecycleV3(programmeLifecyclePlanV3(saved), signedTransaction));
  if (saved.attempt) requireReward(saved.attempt.id === attemptId && same(saved.attempt.body, body), "reward_programme_lifecycle_attempt_conflict");
  return storeProgrammeLifecycleAttemptV3(actor, scope, { attemptId, body }, rpc);
}

/** Private recovery: recompose the salted allocation and verify every signed
 * witness again. Returned bytes remain private and are NOT a broadcast lease. */
export async function loadVerifiedProgrammeLifecycleV3(identity: RewardAccountIdentity,
  input: ProgrammeLifecycleScopeV3 & { attemptId: string }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId);
  const saved = await readProgrammeLifecycleV3(actor, scope, rpc);
  requireReward(saved.attempt?.id === attemptId, "reward_programme_lifecycle_required");
  const plan = programmeLifecyclePlanV3(saved);
  const verified = await verifySignedRewardProgrammeLifecycleV3(plan, saved.attempt.body.signedTransaction);
  requireReward(same(storageBody(verified), saved.attempt.body), "reward_programme_lifecycle_attempt_conflict");
  const fresh = await readProgrammeLifecycleV3(actor, scope, rpc);
  requireReward(fresh.attempt?.id === attemptId && same(fresh.attempt.body, saved.attempt.body) && same(programmeLifecyclePlanV3(fresh), plan),
    "reward_programme_lifecycle_attempt_conflict");
  return { status: source(fresh).current ? "current" as const : "held" as const, intentId: scope.intentId, attemptId, plan, verified };
}
