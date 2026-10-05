import { decodeEventLog, encodeFunctionData, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from "viem";
import { readProgrammeRegistryV3, rewardResultReviewV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { programmeDepositAmountV3, decodeProgrammeDepositQuoteV3, type ProgrammeDepositReviewV3 } from "@raceson/domain/rewards/programme-deposit-v3";
import { canonicalRewardJson, hashPublicRewardRules } from "@raceson/rewards-chain";
import { rewardProgrammeV3Abi, readVerifiedRewardProgrammeV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { readRegisteredProgrammeFundingV3 } from "./programme-registry-v3-service.js";

type Dependencies = { rpc?: RewardLedgerRpc; reader?: RewardProgrammeReaderV3 };
type Scope = { chainId: 31337 | 10143; draftId: string };
export async function prepareProgrammeDepositQuoteV3(identity: RewardAccountIdentity, scope: Scope, amountMon: unknown,
  { rpc, reader }: Dependencies): Promise<ProgrammeDepositReviewV3> {
  const actor = { ...identity }, fixed = { ...scope }, amount = programmeDepositAmountV3(amountMon);
  const saved = await readProgrammeRegistryV3(actor, fixed, rpc);
  const blocked = (reason: Extract<ProgrammeDepositReviewV3, { status: "blocked" }>["reason"]): ProgrammeDepositReviewV3 => ({ status: "blocked", reason });
  if (!saved.registry) return blocked("deployment_required");
  const { context } = saved, view = context.approvalView, intent = context.intent;
  requireReward(intent?.current, "reward_programme_approval_required");
  const funding = await readRegisteredProgrammeFundingV3(actor, view.record, { reader, rpc }), observed = funding.observation;
  requireReward(observed, "reward_programme_deployment_required");
  if (observed.fundingAborted) return blocked("funding_stopped");
  if (BigInt(observed.depositedWei) === BigInt(funding.budgetWei)) return blocked("fully_funded");
  requireReward(amount + BigInt(observed.depositedWei) <= BigInt(funding.budgetWei), "invalid_programme_deposit");
  if (fixed.chainId !== 31337) return blocked("testnet_execution_not_approved");
  const policies = [];
  for (const mapping of view.workspace.mapping.rounds) {
    const round = view.workspace.catalogue.rounds.find(r => r.id === mapping.roundId && r.slot === mapping.slot);
    requireReward(round && round.races.length > 0 && round.status !== "cancelled", "reward_programme_approval_required");
    for (const race of round.races) {
      const p = await rewardResultReviewV3(actor, race.id, undefined, rpc);
      if (!p.policyId || p.held || p.organizationId !== view.record.organizationId || p.reviewSeconds !== intent.terms.reviewPeriods[mapping.slot - 1]) return blocked("policy_required");
      policies.push({ categoryId: race.id, policyId: p.policyId, revision: p.revision, reviewSeconds: p.reviewSeconds });
    }
  }
  // Re-read all policy identities and current Auth/context after asynchronous IO.
  for (const p of policies) {
    const fresh = await rewardResultReviewV3(actor, p.categoryId, undefined, rpc);
    requireReward(!fresh.held && fresh.policyId === p.policyId && fresh.revision === p.revision && fresh.reviewSeconds === p.reviewSeconds, "reward_programme_approval_required");
  }
  const fresh = await readProgrammeRegistryV3(actor, fixed, rpc);
  requireReward(fresh.context.intent?.current && canonicalRewardJson(fresh) === canonicalRewardJson(saved), "reward_programme_approval_required");
  return { status: "ready", quote: decodeProgrammeDepositQuoteV3({ schema: "raceson-programme-deposit-v3", chainId: fixed.chainId,
    draftId: fixed.draftId, rulesRevision: view.record.revision, address: observed.address.toLowerCase(), funderAddress: observed.funderAddress.toLowerCase(),
    approvalId: intent.approvalId, contextHash: intent.contextHash, policyHash: hashPublicRewardRules(policies), expectedDepositedWei: observed.depositedWei,
    amountWei: amount.toString(), budgetWei: funding.budgetWei, expiresAt: new Date(Date.now() + 120000).toISOString() }) };
}

/** Receipt inspection is read-only and remains available after a source hold.
 * A hash alone never proves a deposit; exact sender/target/calldata/value, event,
 * canonical finality and factory history must agree. No replacement/resend. */
export async function inspectProgrammeDepositV3(identity: RewardAccountIdentity, input: unknown, transactionHash: Hex, { rpc, reader }: Dependencies) {
  const q = decodeProgrammeDepositQuoteV3(input), actor = { ...identity };
  requireReward(/^0x[0-9a-f]{64}$/.test(transactionHash), "invalid_programme_deposit");
  const scope = { chainId: q.chainId, draftId: q.draftId }, saved = await readProgrammeRegistryV3(actor, scope, rpc), i = saved.context.intent;
  requireReward(saved.registry && i && reader && i.approvalId === q.approvalId && i.contextHash === q.contextHash, "reward_programme_deployment_required");
  const plan = programmeDeploymentPlanV3(saved.context);
  requireReward(plan.context.verifyingContract.toLowerCase() === q.address && plan.funderAddress.toLowerCase() === q.funderAddress && plan.budgetWei.toString() === q.budgetWei,
    "invalid_programme_deposit");
  const expected = { ...plan, deploymentTransactionHash: saved.registry.provenance.transactionHash };
  const funding = await readVerifiedRewardProgrammeV3(reader, expected);
  const provenance = saved.registry.provenance;
  requireReward(provenance.contractAddress === q.address && provenance.programmeId === plan.programmeId
    && provenance.programmeManifestHash === plan.programmeManifestHash && provenance.runtimeCodeHash === funding.runtimeCodeHash
    && provenance.deploymentBlockNumber === funding.deploymentBlockNumber && provenance.deploymentBlockHash === funding.deploymentBlockHash
    && provenance.finalizedBlockNumber <= funding.finalizedBlock.number, "invalid_programme_deposit");
  async function registryAnchor() {
    const block = await reader!.getBlock({ blockNumber: provenance.finalizedBlockNumber });
    requireReward(block.number === provenance.finalizedBlockNumber && block.hash === provenance.finalizedBlockHash
      && block.timestamp === provenance.finalizedBlockTimestamp, "invalid_programme_deposit");
  }
  await registryAnchor();
  let result: { status: "pending" | "confirmed" | "reverted"; transactionHash: Hex } = { status: "pending", transactionHash };
  try {
    const tx = await reader.getTransaction({ hash: transactionHash });
    requireReward(tx.hash === transactionHash && tx.chainId === q.chainId && tx.from.toLowerCase() === q.funderAddress && tx.to?.toLowerCase() === q.address
      && tx.value.toString() === q.amountWei && tx.input === encodeFunctionData({ abi: rewardProgrammeV3Abi, functionName: "deposit", args: [BigInt(q.expectedDepositedWei)] }), "invalid_programme_deposit");
    if (tx.blockNumber !== null && tx.blockNumber <= funding.finalizedBlock.number) {
      const receipt = await reader.getTransactionReceipt({ hash: transactionHash });
      const block = await reader.getBlock({ blockNumber: tx.blockNumber });
      requireReward(receipt.transactionHash === tx.hash && receipt.blockNumber === tx.blockNumber && receipt.blockHash === tx.blockHash && block.hash === tx.blockHash, "invalid_programme_deposit");
      if (receipt.status === "success") {
        const logs = receipt.logs.filter(l => l.address.toLowerCase() === q.address);
        requireReward(logs.length === 1, "invalid_programme_deposit");
        requireReward(logs[0]!.transactionHash === transactionHash && logs[0]!.blockHash === receipt.blockHash
          && logs[0]!.blockNumber === receipt.blockNumber && !logs[0]!.removed, "invalid_programme_deposit");
        const e = decodeEventLog({ abi: rewardProgrammeV3Abi, topics: logs[0]!.topics, data: logs[0]!.data });
        requireReward(e.eventName === "Deposited" && e.args.funder.toLowerCase() === q.funderAddress && e.args.amount.toString() === q.amountWei
          && e.args.total === BigInt(q.expectedDepositedWei) + BigInt(q.amountWei) && funding.depositedWei >= e.args.total, "invalid_programme_deposit");
      } else requireReward(receipt.status === "reverted", "invalid_programme_deposit");
      result = { status: receipt.status === "success" ? "confirmed" : "reverted", transactionHash };
      requireReward((await reader.getBlock({ blockNumber: tx.blockNumber })).hash === block.hash, "invalid_programme_deposit");
    }
  } catch (error) { if (!(error instanceof TransactionNotFoundError) && !(error instanceof TransactionReceiptNotFoundError)) throw error; }
  await registryAnchor();
  requireReward(await reader.getChainId() === q.chainId, "invalid_programme_deposit");
  // Live access is checked after all provider IO, including the history anchor.
  const fresh = await readProgrammeRegistryV3(actor, scope, rpc);
  requireReward(canonicalRewardJson(fresh.registry) === canonicalRewardJson(saved.registry) && fresh.context.intent?.id === i.id, "invalid_programme_deposit");
  return result;
}
