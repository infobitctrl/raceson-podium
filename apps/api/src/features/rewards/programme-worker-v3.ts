import { TransactionNotFoundError, keccak256, type Hex, type PublicClient } from "viem";
import { readProgrammeJobV3, queueProgrammeJobV3, stepProgrammeJobV3, rewardDocumentUuid as uuid,
  type ProgrammeAttemptScopeV3, type RewardAccountIdentity, type RewardLedgerRpc, type ProgrammeJobV3 } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { readVerifiedRewardProgrammeV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { loadVerifiedProgrammeAttemptV3 } from "./programme-attempt-v3-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

function capture(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3 & { jobId: string }) {
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    scope: { chainId: input.chainId, draftId: uuid(input.draftId), intentId: uuid(input.intentId), jobId: uuid(input.jobId) } };
}
function sameJob(a: ProgrammeJobV3, b: ProgrammeJobV3) {
  requireReward(a.jobId === b.jobId && a.intentId === b.intentId && a.attemptId === b.attemptId
    && a.transactionHash === b.transactionHash && a.createdByUserId === b.createdByUserId, "reward_programme_job_conflict");
}
export async function queueVerifiedProgrammeDeploymentV3(identity: RewardAccountIdentity,
  input: ProgrammeAttemptScopeV3 & { jobId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId);
  const verified = await loadVerifiedProgrammeAttemptV3(actor, { ...scope, attemptId }, rpc);
  const job = await queueProgrammeJobV3(actor, { ...scope, attemptId }, rpc);
  requireReward(job.transactionHash === verified.verified.transactionHash, "reward_programme_job_conflict");
  return job;
}
type Reader = RewardProgrammeReaderV3 & Pick<PublicClient, "getTransactionCount">;
type Outcome = "confirmed" | "busy" | "held" | "pending" | "submitted" | "awaiting_nonce" | "nonce_conflict" | "unavailable" | "broadcast_unknown" | "requires_attention";

/** Bounded PRIVATE worker. No signing, replacement, autonomous scheduling or
 * public execution route. Clients/broadcaster belong to an isolated operator,
 * not request inputs. Lease fencing cannot revoke bytes already released. */
export async function runProgrammeDeploymentJobV3(identity: RewardAccountIdentity,
  input: ProgrammeAttemptScopeV3 & { jobId: string; workerId: string },
  dependencies: { rpc?: RewardLedgerRpc; reader: Reader; broadcast: (signed: Hex) => Promise<Hex> }) {
  const { actor, scope } = capture(identity, input), workerId = uuid(input.workerId), { rpc, reader, broadcast } = dependencies;
  const result = (outcome: Outcome) => ({ jobId: scope.jobId, outcome });
  const original = await readProgrammeJobV3(actor, scope, rpc);
  requireReward(original?.jobId === scope.jobId, "reward_programme_job_required");
  if (original.state === "confirmed") return result("confirmed");
  const lease = await stepProgrammeJobV3(actor, { ...scope, workerId, leaseToken: null, action: "lease" }, rpc);
  if (!lease) return result("busy");
  sameJob(original, lease);
  if (lease.state === "confirmed") return result("confirmed");
  const step = async (action: "arm" | "submitted" | "confirm", provenance?: unknown) => {
    const next = await stepProgrammeJobV3(actor, { ...scope, workerId, leaseToken: lease.leaseToken, action, provenance }, rpc);
    requireReward(next, "reward_programme_lease_lost"); sameJob(lease, next); return next;
  };
  const attempt = await loadVerifiedProgrammeAttemptV3(actor, { ...scope, attemptId: lease.attemptId }, rpc), a = attempt.verified;
  requireReward(a.transactionHash === lease.transactionHash, "reward_programme_job_conflict");
  let tx: Awaited<ReturnType<Reader["getTransaction"]>> | undefined, missing = false;
  try {
    requireReward(await reader.getChainId() === scope.chainId, "reward_observed_chain_mismatch");
    try { tx = await reader.getTransaction({ hash: a.transactionHash }); }
    catch (error) { if (!(error instanceof TransactionNotFoundError)) throw error; missing = true; }
  } catch { return result("unavailable"); }
  if (!missing) {
    try {
      if (!tx || tx.hash !== a.transactionHash || tx.chainId !== scope.chainId || tx.from.toLowerCase() !== a.operatorAddress.toLowerCase()
        || !Number.isSafeInteger(tx.nonce) || BigInt(tx.nonce) !== a.nonce || tx.to !== null || tx.value !== 0n
        || tx.gas !== a.gasLimit || tx.maxFeePerGas !== a.maxFeePerGas || (tx.maxPriorityFeePerGas ?? 0n) !== a.maxPriorityFeePerGas
        || typeof tx.input !== "string" || keccak256(tx.input) !== a.calldataHash || (tx.blockNumber === null) !== (tx.blockHash === null)) return result("requires_attention");
      if (tx.blockNumber === null) {
        requireReward(await reader.getChainId() === scope.chainId, "reward_observed_chain_mismatch");
        await step("submitted"); return result("pending");
      }
      const verified = await readVerifiedRewardProgrammeV3(reader, { ...attempt.plan, deploymentTransactionHash: a.transactionHash });
      const provenance = { schemaVersion: 3, chainId: scope.chainId, contractAddress: verified.context.verifyingContract.toLowerCase(), transactionHash: a.transactionHash,
        deploymentBlockNumber: verified.deploymentBlockNumber, deploymentBlockHash: verified.deploymentBlockHash, finalizedBlockNumber: verified.finalizedBlock.number,
        finalizedBlockHash: verified.finalizedBlock.hash, finalizedBlockTimestamp: verified.finalizedBlock.timestamp, runtimeCodeHash: verified.runtimeCodeHash,
        programmeId: verified.programmeId, programmeManifestHash: verified.programmeManifestHash };
      const confirmed = await step("confirm", provenance);
      requireReward(confirmed.state === "confirmed", "reward_programme_not_verified"); return result("confirmed");
    } catch { return result("unavailable"); }
  }
  // Reconcile known transactions even after a source hold, but never newly send.
  if (attempt.status === "held") return result("held");
  try {
    const [latest, pending, balance, code] = await Promise.all([
      reader.getTransactionCount({ address: a.operatorAddress, blockTag: "latest" }), reader.getTransactionCount({ address: a.operatorAddress, blockTag: "pending" }),
      reader.getBalance({ address: a.operatorAddress, blockTag: "latest" }), reader.getCode({ address: a.contractAddress, blockTag: "latest" }),
    ]);
    if (!Number.isSafeInteger(latest) || latest < 0 || !Number.isSafeInteger(pending) || pending < latest || await reader.getChainId() !== scope.chainId) return result("unavailable");
    if (BigInt(latest) > a.nonce || BigInt(pending) > a.nonce) return result("nonce_conflict");
    if (BigInt(latest) < a.nonce || BigInt(pending) < a.nonce) return result("awaiting_nonce");
    if (balance < a.gasLimit * a.maxFeePerGas || code !== undefined && code !== "0x") return result("requires_attention");
  } catch { return result("unavailable"); }
  let armed;
  try { armed = await step("arm"); }
  catch (error) { return result(error && typeof error === "object" && "code" in error && error.code === "reward_programme_approval_required" ? "held" : "unavailable"); }
  if (armed.state === "confirmed") return result("confirmed");
  if (!rewardLeaseCanStartSend(armed)) return result("busy");
  try {
    const hash = await broadcast(a.signedTransaction);
    if (hash !== a.transactionHash) return result("broadcast_unknown");
    await step("submitted"); return result("submitted");
  } catch { return result("broadcast_unknown"); }
}
