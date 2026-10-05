import { keccak256, toHex, type Address, type Hex } from "viem";
import { readProgrammeLifecycleV3, rewardDocumentUuid as uuid, type ProgrammeLifecycleScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { encodeRewardProgrammeLifecycleV3, readRewardProgrammeLifecyclePrestateV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeLifecyclePlanV3, loadVerifiedProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3 } from "./programme-lifecycle-v3-service.js";
type Context = Awaited<ReturnType<typeof readProgrammeLifecycleV3>>;
type Scope = ProgrammeLifecycleScopeV3 & { attemptId: string };
type Dependencies = { reader: RewardProgrammeReaderV3; rpc?: RewardLedgerRpc };
function capture(actor: RewardAccountIdentity, s: Scope) {
  requireReward([31337, 10143].includes(s.chainId) && Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= 6, "invalid_reward_programme_signing_plan");
  return { actor: { userId: uuid(actor.userId), sessionId: uuid(actor.sessionId) }, scope: { chainId: s.chainId, draftId: uuid(s.draftId), slot: s.slot,
    approvalId: uuid(s.approvalId), uploadId: uuid(s.uploadId), intentId: uuid(s.intentId), attemptId: uuid(s.attemptId) } };
}
const current = (c: Context) => requireReward(c.upload.current && c.registry.context.intent?.current, "reward_allocation_not_ready");
export function programmeSigningPlanV3(c: Context, scope: Scope) {
  const p = programmeLifecyclePlanV3(c), tx = encodeRewardProgrammeLifecycleV3(p), i = c.intent!;
  const body = { schema: "raceson-programme-signing-plan-v3" as const, ...scope, action: p.action,
    programmeAddress: p.programme.context.verifyingContract.toLowerCase(), campaignAddress: tx.to.toLowerCase(), operatorAddress: i.operatorAddress,
    nonce: i.nonce.toString(), valueWei: "0", packageHash: i.body.packageHash, calldataHash: keccak256(tx.data),
    enabledPot: p.upload.enabledPot, budgetWei: p.upload.budgetWei, allocatedWei: p.upload.allocatedWei,
    batchStart: p.action === "upload_awards" ? p.batchStart : null, batchSize: p.action === "upload_awards" ? p.batchSize : null,
    publication: "publication" in p ? { reviewPeriod: p.publication.reviewPeriod.toString(), reviewStartedAt: p.publication.reviewStartedAt.toString(),
      officialPublishedAt: p.publication.officialPublishedAt.toString(), publicationEvidenceHash: p.publication.publicationEvidenceHash } : null,
    fees: Object.fromEntries(Object.entries(p.fees).map(([k, v]) => [k, v.toString()])) };
  return { ...body, planHash: keccak256(toHex(canonicalRewardJson(body))) };
}
export async function inspectProgrammeSigningV3(actor: RewardAccountIdentity, scope: Scope, deps: Dependencies) {
  const fixed = capture(actor, scope), first = await readProgrammeLifecycleV3(fixed.actor, fixed.scope, deps.rpc);
  const plan = programmeSigningPlanV3(first, fixed.scope);
  const recorded = async (c: Context) => {
    requireReward(c.attempt?.id === fixed.scope.attemptId, "reward_programme_lifecycle_attempt_conflict");
    const saved = await loadVerifiedProgrammeLifecycleV3(fixed.actor, fixed.scope, deps.rpc);
    return { plan, recorded: true as const, transactionHash: saved.verified.transactionHash };
  };
  if (first.attempt) return recorded(first);
  current(first);
  await readRewardProgrammeLifecyclePrestateV3(deps.reader, programmeLifecyclePlanV3(first));
  // Provider IO must not outlive source or session authority.
  const fresh = await readProgrammeLifecycleV3(fixed.actor, fixed.scope, deps.rpc);
  requireReward(programmeSigningPlanV3(fresh, fixed.scope).planHash === plan.planHash, "reward_programme_signing_plan_changed");
  if (fresh.attempt) return recorded(fresh);
  current(fresh); return { plan, recorded: false as const, transactionHash: null };
}
export type ProgrammeSignerV3 = { address: Address; signTransaction: (tx: { chainId: number; to: Address; nonce: number; value: bigint; data: Hex;
  type: "eip1559"; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => Promise<Hex> };
/** Injected local operator signer only, never an HTTP handler or athlete key.
 * Exact-plan approval precedes key loading; this function has no broadcast,
 * queue, reservation, funding or publication capability. */
export async function signProgrammeV3(actor: RewardAccountIdentity, input: Scope & { planHash: Hex },
  deps: Dependencies & { signal: AbortSignal; loadSigner: () => Promise<ProgrammeSignerV3> }) {
  const fixed = capture(actor, input), planHash = input.planHash, { signal, loadSigner, reader, rpc } = deps;
  requireReward(typeof planHash === "string" && /^0x[0-9a-f]{64}$/.test(planHash), "invalid_reward_programme_signing_plan");
  const active = () => requireReward(!signal.aborted, "reward_programme_signing_stopped"); active();
  const inspect = () => inspectProgrammeSigningV3(fixed.actor, fixed.scope, { reader, rpc });
  const review = await inspect(); active();
  requireReward(review.plan.planHash === planHash, "reward_programme_signing_plan_changed");
  if (review.recorded) return review;
  let signer: ProgrammeSignerV3;
  try { signer = await loadSigner(); } catch { throw Error("reward_programme_signer_unavailable"); } active();
  requireReward(signer.address.toLowerCase() === review.plan.operatorAddress, "reward_programme_signer_mismatch");
  const fresh = await inspect(); active();
  requireReward(fresh.plan.planHash === planHash, "reward_programme_signing_plan_changed");
  if (fresh.recorded) return fresh;
  const last = await readProgrammeLifecycleV3(fixed.actor, fixed.scope, rpc); active();
  requireReward(programmeSigningPlanV3(last, fixed.scope).planHash === planHash, "reward_programme_signing_plan_changed");
  if (last.attempt) return inspect();
  current(last); const p = programmeLifecyclePlanV3(last); let signedTransaction: Hex;
  try { signedTransaction = await signer.signTransaction({ ...encodeRewardProgrammeLifecycleV3(p), type: "eip1559", gas: p.fees.gasLimit,
    maxFeePerGas: p.fees.maxFeePerGas, maxPriorityFeePerGas: p.fees.maxPriorityFeePerGas }); }
  catch { throw Error("reward_programme_signer_unavailable"); } active();
  await recordSignedProgrammeLifecycleV3(fixed.actor, { ...fixed.scope, signedTransaction }, rpc); active();
  return inspect();
}
