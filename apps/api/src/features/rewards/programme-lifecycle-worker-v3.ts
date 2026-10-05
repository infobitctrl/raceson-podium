import { TransactionNotFoundError, keccak256, type Hex, type PublicClient } from "viem";
import { readProgrammeLifecycleJobV3, queueProgrammeLifecycleJobV3, stepProgrammeLifecycleJobV3, rewardDocumentUuid as uuid,
  type ProgrammeLifecycleScopeV3, type RewardAccountIdentity, type RewardLedgerRpc, type ProgrammeJobV3 } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardProgrammeLifecyclePrestateV3, readVerifiedRewardProgrammeLifecycleV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { loadVerifiedProgrammeLifecycleV3 } from "./programme-lifecycle-v3-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

function capture(identity: RewardAccountIdentity, input: ProgrammeLifecycleScopeV3 & { jobId: string }) {
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, scope: { chainId: input.chainId,
    draftId: uuid(input.draftId), slot: input.slot, approvalId: uuid(input.approvalId), uploadId: uuid(input.uploadId), intentId: uuid(input.intentId), jobId: uuid(input.jobId) } };
}
function sameJob(a: ProgrammeJobV3, b: ProgrammeJobV3) {
  requireReward(a.jobId === b.jobId && a.intentId === b.intentId && a.attemptId === b.attemptId && a.transactionHash === b.transactionHash
    && a.createdByUserId === b.createdByUserId, "reward_programme_lifecycle_job_conflict");
}
export async function queueVerifiedProgrammeLifecycleV3(identity: RewardAccountIdentity,
  input: ProgrammeLifecycleScopeV3 & { jobId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId);
  const attempt = await loadVerifiedProgrammeLifecycleV3(actor, { ...scope, attemptId }, rpc);
  const job = await queueProgrammeLifecycleJobV3(actor, { ...scope, attemptId }, rpc);
  requireReward(job.transactionHash === attempt.verified.transactionHash, "reward_programme_lifecycle_job_conflict"); return job;
}
type Reader = RewardProgrammeReaderV3 & Pick<PublicClient, "getTransactionCount">;
type Outcome = "confirmed" | "busy" | "held" | "pending" | "submitted" | "awaiting_nonce" | "nonce_conflict" | "unavailable"
  | "broadcast_unknown" | "requires_attention" | "awaiting_predecessor";

/** One bounded PRIVATE execution step. Never signs, replaces bytes/nonces,
 * discovers providers or schedules itself. No public execution route. */
export async function runProgrammeLifecycleJobV3(identity: RewardAccountIdentity,
  input: ProgrammeLifecycleScopeV3 & { jobId: string; workerId: string },
  dependencies: { rpc?: RewardLedgerRpc; reader: Reader; broadcast: (signed: Hex) => Promise<Hex> }) {
  const { actor, scope } = capture(identity, input), workerId = uuid(input.workerId), { rpc, reader, broadcast } = dependencies;
  const result = (outcome: Outcome) => ({ jobId: scope.jobId, outcome });
  const original = (await readProgrammeLifecycleJobV3(actor, scope, rpc)).job;
  requireReward(original?.jobId === scope.jobId, "reward_programme_lifecycle_job_required");
  if (original.state === "confirmed") return result("confirmed");
  const lease = await stepProgrammeLifecycleJobV3(actor, { ...scope, workerId, leaseToken: null, action: "lease" }, rpc);
  if (!lease) return result("busy"); sameJob(original, lease);
  if (lease.state === "confirmed") return result("confirmed");
  const step = async (action: "arm" | "submitted" | "confirm", receipt?: unknown) => {
    const next = await stepProgrammeLifecycleJobV3(actor, { ...scope, workerId, leaseToken: lease.leaseToken, action, receipt }, rpc);
    requireReward(next, "reward_programme_lifecycle_lease_lost"); sameJob(lease, next); return next;
  };
  const attempt = await loadVerifiedProgrammeLifecycleV3(actor, { ...scope, attemptId: lease.attemptId }, rpc), a = attempt.verified;
  requireReward(a.transactionHash === lease.transactionHash, "reward_programme_lifecycle_job_conflict");
  let tx: Awaited<ReturnType<Reader["getTransaction"]>> | undefined, missing = false;
  try {
    requireReward(await reader.getChainId() === scope.chainId, "reward_observed_chain_mismatch");
    try { tx = await reader.getTransaction({ hash: a.transactionHash }); }
    catch (error) { if (!(error instanceof TransactionNotFoundError)) throw error; missing = true; }
  } catch { return result("unavailable"); }
  if (!missing) {
    try {
      if (!tx || tx.hash !== a.transactionHash || tx.chainId !== scope.chainId || tx.type !== "eip1559" || (tx.accessList?.length ?? 0) !== 0
        || tx.from.toLowerCase() !== a.operatorAddress.toLowerCase() || tx.to?.toLowerCase() !== a.contractAddress.toLowerCase()
        || !Number.isSafeInteger(tx.nonce) || BigInt(tx.nonce) !== a.nonce || tx.value !== 0n || tx.gas !== a.gasLimit
        || tx.maxFeePerGas !== a.maxFeePerGas || (tx.maxPriorityFeePerGas ?? 0n) !== a.maxPriorityFeePerGas
        || typeof tx.input !== "string" || keccak256(tx.input) !== a.calldataHash || (tx.blockNumber === null) !== (tx.blockHash === null))
        return result("requires_attention");
      if (tx.blockNumber === null) {
        requireReward(await reader.getChainId() === scope.chainId, "reward_observed_chain_mismatch");
        await step("submitted"); return result("pending");
      }
      const receipt = await readVerifiedRewardProgrammeLifecycleV3(reader, attempt.plan, a.signedTransaction);
      const stored = { ...receipt, campaignAddress: receipt.campaignAddress.toLowerCase(),
        provenance: { ...receipt.provenance, programmeAddress: receipt.provenance.programmeAddress.toLowerCase() } };
      requireReward((await step("confirm", stored)).state === "confirmed", "reward_programme_lifecycle_receipt_required");
      return result("confirmed");
    } catch { return result("unavailable"); }
  }
  // Reconciliation survives source holds; sending a missing transaction does not.
  if (attempt.status === "held") return result("held");
  try {
    await readRewardProgrammeLifecyclePrestateV3(reader, attempt.plan);
    const [latest, pending, balance] = await Promise.all([
      reader.getTransactionCount({ address: a.operatorAddress, blockTag: "latest" }),
      reader.getTransactionCount({ address: a.operatorAddress, blockTag: "pending" }), reader.getBalance({ address: a.operatorAddress, blockTag: "latest" }),
    ]);
    if (!Number.isSafeInteger(latest) || latest < 0 || !Number.isSafeInteger(pending) || pending < latest || await reader.getChainId() !== scope.chainId)
      return result("unavailable");
    if (BigInt(latest) > a.nonce || BigInt(pending) > a.nonce) return result("nonce_conflict");
    if (BigInt(latest) < a.nonce || BigInt(pending) < a.nonce) return result("awaiting_nonce");
    if (typeof balance !== "bigint" || balance < a.gasLimit * a.maxFeePerGas) return result("requires_attention");
  } catch { return result("unavailable"); }
  let armed;
  try { armed = await step("arm"); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    return result(code === "reward_allocation_not_ready" ? "held" : code === "reward_programme_lifecycle_predecessor_required" ? "awaiting_predecessor" : "unavailable");
  }
  if (armed.state === "confirmed") return result("confirmed");
  if (!rewardLeaseCanStartSend(armed)) return result("busy");
  try {
    if (await broadcast(a.signedTransaction) !== a.transactionHash) return result("broadcast_unknown");
    await step("submitted"); return result("submitted");
  } catch { return result("broadcast_unknown"); }
}
