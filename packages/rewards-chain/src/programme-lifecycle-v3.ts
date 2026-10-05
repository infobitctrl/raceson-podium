import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseTransaction,
  recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { rewardUploadDigest, type RewardPublicAward } from "./allocation.js";
import { canonicalRewardJson } from "./canonical.js";
import { validateRewardCampaignAccounting, type RewardCampaignAccounting } from "./campaign-checkpoint.js";
import { normalizeRewardFinalPublicationV3, rewardAllocationCommitmentV3, rewardCampaignV3Abi as abi,
  type RewardFinalPublicationV3 } from "./campaign-v3.js";
import { normalizeRewardProgrammeV3, readVerifiedRewardProgrammeV3, rewardProgrammeChildV3,
  type RewardProgrammeExpectationV3, type RewardProgrammeReaderV3 } from "./programme-v3.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

const check = (value: unknown) => demand(value, "reward_programme_lifecycle_mismatch");
function object(value: unknown, keys: readonly string[]) {
  check(value && typeof value === "object" && !Array.isArray(value));
  const fields = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(value as object).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function decimal(value: unknown) {
  check(typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value));
  return uint(BigInt(value as string));
}

/** Decode the exact persisted PUBLIC row package. No review times are invented
 * to make an upload possible. SQL approval/randomness provenance remains the
 * private service's responsibility; this verifies binding and arithmetic only. */
export function decodeRewardProgrammeUploadV3(programmeInput: RewardProgrammeExpectationV3, slot: number, value: unknown) {
  const programme = normalizeRewardProgrammeV3(programmeInput), child = rewardProgrammeChildV3(programme, slot);
  const v = object(value, ["schema", "protocolVersion", "chainId", "programmeAddress", "campaignAddress", "deploymentTransactionHash",
    "programmeId", "campaignId", "programmeManifestHash", "enabledPot", "reviewPeriod", "budgetWei", "allocatedWei",
    "unallocatedWei", "snapshotDigest", "uploadDigest", "entitlementCount", "awards"]);
  check(v.schema === "raceson-award-upload-v3" && v.protocolVersion === 3 && v.chainId === programme.context.chainId
    && walletAddress(v.programmeAddress as Hex) === programme.context.verifyingContract
    && walletAddress(v.campaignAddress as Hex) === child.context.verifyingContract
    && bytes32(v.deploymentTransactionHash as Hex) === programme.deploymentTransactionHash
    && bytes32(v.programmeId as Hex) === child.programmeId && bytes32(v.campaignId as Hex) === child.campaignId
    && bytes32(v.programmeManifestHash as Hex) === child.programmeManifestHash && v.enabledPot === child.enabledPot
    && decimal(v.reviewPeriod) === child.reviewPeriod && decimal(v.budgetWei) === child.budgetWei);
  check(Array.isArray(v.awards) && v.awards.length <= 20000);
  const rawRows = v.awards as unknown[], fields = Object.getOwnPropertyDescriptors(rawRows);
  check(Reflect.ownKeys(rawRows).length === rawRows.length + 1);
  const awards = Array.from({ length: rawRows.length }, (_, i): RewardPublicAward => {
    check(fields[String(i)]?.enumerable && "value" in fields[String(i)]!);
    const r = object(fields[String(i)]!.value, ["entitlementId", "beneficiaryId", "pot", "amount", "explanationHash", "beneficiaryKind"]);
    check(r.pot === child.enabledPot && (r.beneficiaryKind === 0 || r.beneficiaryKind === 1));
    return { entitlementId: bytes32(r.entitlementId as Hex), beneficiaryId: bytes32(r.beneficiaryId as Hex), pot: child.enabledPot,
      amount: decimal(r.amount), explanationHash: bytes32(r.explanationHash as Hex), beneficiaryKind: r.beneficiaryKind as 0 | 1 };
  });
  const upload = rewardUploadDigest(awards, child.enabledPot, child.budgetWei);
  check(upload.digest === bytes32(v.uploadDigest as Hex, true) && upload.count === decimal(v.entitlementCount)
    && upload.total === decimal(v.allocatedWei) && child.budgetWei - upload.total === decimal(v.unallocatedWei));
  return { schema: "raceson-award-upload-v3" as const, protocolVersion: 3 as const, chainId: programme.context.chainId,
    programmeAddress: programme.context.verifyingContract.toLowerCase() as Hex, campaignAddress: child.context.verifyingContract.toLowerCase() as Hex,
    deploymentTransactionHash: programme.deploymentTransactionHash, programmeId: child.programmeId, campaignId: child.campaignId,
    programmeManifestHash: child.programmeManifestHash, enabledPot: child.enabledPot, reviewPeriod: child.reviewPeriod.toString(),
    budgetWei: child.budgetWei.toString(), allocatedWei: upload.total.toString(), unallocatedWei: (child.budgetWei - upload.total).toString(),
    snapshotDigest: bytes32(v.snapshotDigest as Hex), uploadDigest: upload.digest, entitlementCount: upload.count.toString(),
    awards: awards.map(row => ({ ...row, amount: row.amount.toString() })) };
}
export type RewardProgrammeUploadV3 = ReturnType<typeof decodeRewardProgrammeUploadV3>;
type Fees = { gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; maxGasCostWei: bigint };
type Common = { protocolVersion: 3; programme: RewardProgrammeExpectationV3; slot: number; nonce: bigint; upload: RewardProgrammeUploadV3; fees: Fees };
export type RewardProgrammeLifecyclePlanV3 = Common & (
  { action: "complete_funding" } | { action: "upload_awards"; batchStart: number; batchSize: number }
  | { action: "stage_allocation" | "activate"; publication: RewardFinalPublicationV3 });

export function normalizeRewardProgrammeLifecycleV3(input: RewardProgrammeLifecyclePlanV3) {
  demand(input.protocolVersion === 3, "wrong_reward_lifecycle_protocol");
  const programme = normalizeRewardProgrammeV3(input.programme), slot = input.slot, child = rewardProgrammeChildV3(programme, slot);
  const upload = decodeRewardProgrammeUploadV3(programme, slot, input.upload), nonce = uint(input.nonce, 64);
  check(nonce > programme.deploymentNonce && nonce <= BigInt(Number.MAX_SAFE_INTEGER));
  const fees: Fees = { gasLimit: uint(input.fees.gasLimit), maxFeePerGas: uint(input.fees.maxFeePerGas),
    maxPriorityFeePerGas: uint(input.fees.maxPriorityFeePerGas), maxGasCostWei: uint(input.fees.maxGasCostWei) };
  demand(fees.gasLimit > 0n && fees.gasLimit <= 30000000n && fees.maxFeePerGas > 0n
    && fees.maxPriorityFeePerGas <= fees.maxFeePerGas && fees.maxGasCostWei > 0n
    && fees.gasLimit * fees.maxFeePerGas <= fees.maxGasCostWei, "invalid_reward_lifecycle_fees");
  const base = { protocolVersion: 3 as const, programme, slot, nonce, upload, fees, child };
  if (input.action === "complete_funding") {
    check(!("publication" in input) && !("batchStart" in input) && !("batchSize" in input));
    return { ...base, action: input.action };
  }
  if (input.action === "upload_awards") {
    check(!("publication" in input) && Number.isSafeInteger(input.batchStart) && input.batchStart >= 0
      && Number.isSafeInteger(input.batchSize) && input.batchSize > 0 && input.batchSize <= 64
      && input.batchStart + input.batchSize <= upload.awards.length);
    return { ...base, action: input.action, batchStart: input.batchStart, batchSize: input.batchSize };
  }
  check((input.action === "stage_allocation" || input.action === "activate") && !("batchStart" in input) && !("batchSize" in input));
  const publication = normalizeRewardFinalPublicationV3(input.publication);
  check(publication.reviewPeriod === child.reviewPeriod);
  const commitment = rewardAllocationCommitmentV3({ ...child, ...publication, budget: child.budgetWei,
    snapshotDigest: upload.snapshotDigest, awards: upload.awards.map(row => ({ ...row, amount: BigInt(row.amount) })) });
  return { ...base, action: input.action, publication, commitment };
}
type Plan = ReturnType<typeof normalizeRewardProgrammeLifecycleV3>;
export function encodeRewardProgrammeLifecycleV3(input: RewardProgrammeLifecyclePlanV3) {
  const p = normalizeRewardProgrammeLifecycleV3(input), u = p.upload;
  const data = p.action === "complete_funding"
    ? encodeFunctionData({ abi, functionName: "completeFunding", args: [p.child.budgetWei, p.child.budgetWei] })
    : p.action === "upload_awards"
      ? encodeFunctionData({ abi, functionName: "uploadAwards", args: [u.awards.slice(p.batchStart, p.batchStart + p.batchSize).map(r => ({ ...r, amount: BigInt(r.amount) }))] })
      : p.action === "stage_allocation"
        ? encodeFunctionData({ abi, functionName: "stageAllocation", args: [u.snapshotDigest, u.uploadDigest, BigInt(u.entitlementCount),
          p.publication.reviewStartedAt, p.publication.officialPublishedAt, p.publication.publicationEvidenceHash] })
        : encodeFunctionData({ abi, functionName: "activate", args: [p.commitment.allocationDigest, u.snapshotDigest] });
  return { chainId: p.programme.context.chainId, to: p.child.context.verifyingContract, nonce: Number(p.nonce), value: 0n, data };
}

/** Private signed bytes only. No signer, provider, storage, nonce reservation or
 * broadcast. The caller must bind the fees/plan to an approved execution intent. */
export async function verifySignedRewardProgrammeLifecycleV3(input: RewardProgrammeLifecyclePlanV3, serialized: Hex) {
  const p = normalizeRewardProgrammeLifecycleV3(input), encoded = encodeRewardProgrammeLifecycleV3(p);
  demand(typeof serialized === "string" && /^0x02(?:[0-9a-fA-F]{2}){1,16384}$/.test(serialized), "invalid_reward_signed_lifecycle");
  const signedTransaction = serialized.toLowerCase() as `0x02${string}`;
  try {
    const tx = parseTransaction(signedTransaction);
    // Canonical RLP encodes a zero tip as empty bytes. viem decodes that field
    // as undefined; this is a valid zero, not a missing fee authorization.
    const priorityFee = tx.maxPriorityFeePerGas ?? 0n;
    check(tx.type === "eip1559" && tx.chainId === encoded.chainId && tx.to != null && walletAddress(tx.to) === encoded.to
      && tx.nonce === encoded.nonce && (tx.value ?? 0n) === 0n && tx.data === encoded.data && (tx.accessList?.length ?? 0) === 0
      && tx.r !== undefined && tx.s !== undefined && (tx.yParity === 0 || tx.yParity === 1)
      && serializeTransaction(tx) === signedTransaction);
    check(BigInt(tx.r!) > 0n && BigInt(tx.s!) > 0n
      && BigInt(tx.s!) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n);
    demand(tx.gas !== undefined && uint(tx.gas) > 0n && tx.gas <= p.fees.gasLimit && tx.maxFeePerGas !== undefined
      && uint(tx.maxFeePerGas) > 0n && tx.maxFeePerGas <= p.fees.maxFeePerGas
      && uint(priorityFee) <= p.fees.maxPriorityFeePerGas && priorityFee <= tx.maxFeePerGas
      && tx.gas * tx.maxFeePerGas <= p.fees.maxGasCostWei, "invalid_reward_lifecycle_fees");
    const signer = walletAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction }));
    demand(signer === p.programme.operatorAddress, "reward_lifecycle_sender_mismatch");
    return { protocolVersion: 3 as const, action: p.action, chainId: encoded.chainId, contractAddress: encoded.to,
      operatorAddress: signer, nonce: p.nonce, transactionHash: keccak256(signedTransaction), calldataHash: keccak256(encoded.data),
      signedTransaction, gasLimit: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: priorityFee };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("invalid_reward_signed_lifecycle");
  }
}

type State = Awaited<ReturnType<typeof readState>>;
async function readState(reader: RewardProgrammeReaderV3, p: Plan, blockNumber: bigint) {
  const address = p.child.context.verifyingContract;
  const names = ["state", "paused", "accountedFunding", "treasuryReturned", "entitlementCount", "uploadDigest",
    "snapshotDigest", "allocationDigest", "activationNotBefore", "claimDeadline", "pausedAt"] as const;
  const pair = async (functionName: "budgets" | "allocated" | "paid") => Promise.all([0n, 1n].map(i =>
    reader.readContract({ address, abi, functionName, args: [i], blockNumber }))) as Promise<[bigint, bigint]>;
  const [scalars, budgets, allocated, paid, nativeBalance, protocolVersion, reviewPeriod, reviewStartedAt, officialPublishedAt, publicationEvidenceHash] = await Promise.all([
    Promise.all(names.map(functionName => reader.readContract({ address, abi, functionName, blockNumber }))), pair("budgets"), pair("allocated"), pair("paid"),
    reader.getBalance({ address, blockNumber }), ...(["PROTOCOL_VERSION", "reviewPeriod", "reviewStartedAt", "officialPublishedAt", "publicationEvidenceHash"] as const)
      .map(functionName => reader.readContract({ address, abi, functionName, blockNumber })),
  ]);
  const scalar = Object.fromEntries(names.map((k, i) => [k, scalars[i]])) as Pick<RewardCampaignAccounting, typeof names[number]>;
  check(protocolVersion === 3n && reviewPeriod === p.child.reviewPeriod);
  return { accounting: validateRewardCampaignAccounting({ ...scalar, budgets, allocated, paid, nativeBalance }, p.child.enabledPot),
    publication: { reviewPeriod: uint(reviewPeriod as bigint, 64), reviewStartedAt: uint(reviewStartedAt as bigint, 64),
      officialPublishedAt: uint(officialPublishedAt as bigint, 64), publicationEvidenceHash: bytes32(publicationEvidenceHash as Hex, true) } };
}
function prefix(p: Plan, s: State) {
  const a = s.accounting, pot = p.child.enabledPot;
  check(a.accountedFunding === p.child.budgetWei && a.entitlementCount <= BigInt(p.upload.entitlementCount));
  const rows = p.upload.awards.slice(0, Number(a.entitlementCount)).map(r => ({ ...r, amount: BigInt(r.amount) }));
  const expected = rewardUploadDigest(rows, pot, p.child.budgetWei);
  demand(a.uploadDigest === expected.digest && a.allocated[pot] === expected.total, "reward_lifecycle_prefix_mismatch");
}
function staged(p: Plan, s: State, timestamp: bigint) {
  check(p.action === "stage_allocation" || p.action === "activate");
  if (p.action !== "stage_allocation" && p.action !== "activate") throw new RewardProtocolError("invalid_reward_lifecycle_action");
  const a = s.accounting;
  check(a.entitlementCount === p.commitment.entitlementCount && a.snapshotDigest === p.upload.snapshotDigest
    && a.allocationDigest === p.commitment.allocationDigest && canonicalRewardJson(s.publication) === canonicalRewardJson(p.publication)
    && a.activationNotBefore >= p.publication.officialPublishedAt && a.activationNotBefore <= timestamp);
}
type Anchor = { finalizedBlock: { number: bigint; hash: Hex; timestamp: bigint }; deploymentBlockNumber: bigint; deploymentBlockHash: Hex };
async function recheck(reader: RewardProgrammeReaderV3, p: Plan, anchor: Anchor, extra?: { number: bigint; hash: Hex; timestamp: bigint }) {
  const f = anchor.finalizedBlock;
  const [chain, final, current, deployment, receiptBlock] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
    reader.getBlock({ blockNumber: f.number }), reader.getBlock({ blockNumber: anchor.deploymentBlockNumber }),
    extra ? reader.getBlock({ blockNumber: extra.number }) : Promise.resolve(null)]);
  demand(chain === p.programme.context.chainId && final.number !== null && final.hash !== null && final.number >= f.number
    && (final.number !== f.number || final.hash === f.hash) && current.number === f.number && current.hash === f.hash && current.timestamp === f.timestamp
    && deployment.number === anchor.deploymentBlockNumber && deployment.hash === anchor.deploymentBlockHash
    && (!extra || (receiptBlock?.number === extra.number && receiptBlock.hash === extra.hash && receiptBlock.timestamp === extra.timestamp)),
  "reward_chain_changed_during_observation");
}

/** One finalized factory/child preflight. Current Auth/source/approval and a
 * short-lived send lease MUST be checked after this IO by the private worker.
 * This returns neither signed bytes nor authorization to broadcast. */
export async function readRewardProgrammeLifecyclePrestateV3(reader: RewardProgrammeReaderV3, input: RewardProgrammeLifecyclePlanV3) {
  const p = normalizeRewardProgrammeLifecycleV3(input);
  try {
    const parent = await readVerifiedRewardProgrammeV3(reader, p.programme), pot = parent.pots[p.slot]!;
    check(pot.routed && !parent.fundingAborted);
    const state = await readState(reader, p, parent.finalizedBlock.number), a = state.accounting;
    const operatorCode = await reader.getCode({ address: p.programme.operatorAddress, blockNumber: parent.finalizedBlock.number });
    demand(operatorCode === undefined || operatorCode === "0x", "reward_lifecycle_eoa_operator_required");
    prefix(p, state);
    demand(a.state === (p.action === "complete_funding" ? 0 : p.action === "activate" ? 2 : 1) && !a.paused,
      "reward_lifecycle_state_mismatch");
    if (p.action === "upload_awards") demand(a.entitlementCount === BigInt(p.batchStart), "reward_lifecycle_prefix_mismatch");
    if (p.action === "stage_allocation" || p.action === "activate") {
      check(a.entitlementCount === p.commitment.entitlementCount);
      demand(p.publication.officialPublishedAt <= parent.finalizedBlock.timestamp, "reward_lifecycle_publication_in_future");
      if (p.action === "activate") staged(p, state, parent.finalizedBlock.timestamp);
    }
    if (p.action !== "activate") check(state.publication.reviewStartedAt === 0n && state.publication.officialPublishedAt === 0n
      && BigInt(state.publication.publicationEvidenceHash) === 0n);
    await recheck(reader, p, parent);
    return { protocolVersion: 3 as const, provenance: { kind: "programme-child" as const, programmeAddress: parent.context.verifyingContract,
      deploymentTransactionHash: parent.deploymentTransactionHash, slot: p.slot }, action: p.action, campaignAddress: pot.address,
      finalizedBlock: parent.finalizedBlock, ...state };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_lifecycle_observation_unavailable");
  }
}

function events(p: Plan, timestamp: bigint) {
  const u = p.upload;
  if (p.action === "complete_funding") return [{ topics: encodeEventTopics({ abi, eventName: "FundingClosed", args: { pot: u.enabledPot } }),
    data: encodeAbiParameters([{ type: "uint256" }], [p.child.budgetWei]) }];
  if (p.action === "upload_awards") return u.awards.slice(p.batchStart, p.batchStart + p.batchSize).map(r => ({
    topics: encodeEventTopics({ abi, eventName: "AwardUploaded", args: { entitlementId: r.entitlementId, beneficiaryId: r.beneficiaryId, pot: r.pot } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }, { type: "uint8" }], [BigInt(r.amount), r.explanationHash, r.beneficiaryKind]) }));
  const c = p.commitment;
  if (p.action === "activate") return [{ topics: encodeEventTopics({ abi, eventName: "Activated", args: { allocationDigest: c.allocationDigest } }),
    data: encodeAbiParameters([{ type: "uint256" }], [timestamp + 31536000n]) }];
  return [{ topics: encodeEventTopics({ abi, eventName: "AllocationStaged", args: { allocationDigest: c.allocationDigest, snapshotDigest: c.snapshotDigest } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [c.entitlementCount, timestamp]) },
  { topics: encodeEventTopics({ abi, eventName: "FinalResultsApproved", args: { allocationDigest: c.allocationDigest, publicationEvidenceHash: c.publicationEvidenceHash } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [c.reviewStartedAt, c.reviewPeriod, c.officialPublishedAt, timestamp]) }];
}

/** Reconcile an EXACT signed attempt, including after later uploads/activation/
 * payments/holds. A historical success is not a fresh send or current payability.
 * No new attempt or nonce is created on a missing/pending/unavailable response. */
export async function readVerifiedRewardProgrammeLifecycleV3(reader: RewardProgrammeReaderV3,
  input: RewardProgrammeLifecyclePlanV3, signed: Hex) {
  const p = normalizeRewardProgrammeLifecycleV3(input);
  const verified = await verifySignedRewardProgrammeLifecycleV3(p, signed), encoded = encodeRewardProgrammeLifecycleV3(p);
  try {
    const parent = await readVerifiedRewardProgrammeV3(reader, p.programme), hash = verified.transactionHash;
    const [tx, receipt] = await Promise.all([reader.getTransaction({ hash }), reader.getTransactionReceipt({ hash })]);
    demand(receipt.status === "success", "reward_lifecycle_reverted");
    check(tx.hash === hash && receipt.transactionHash === hash && tx.to !== null && receipt.to !== null
      && walletAddress(tx.to) === encoded.to && walletAddress(receipt.to) === encoded.to && receipt.contractAddress === null
      && walletAddress(tx.from) === verified.operatorAddress && walletAddress(receipt.from) === verified.operatorAddress
      && tx.chainId === encoded.chainId && tx.type === "eip1559" && tx.nonce === encoded.nonce && tx.value === 0n
      && tx.input.toLowerCase() === encoded.data && (tx.accessList?.length ?? 0) === 0
      && tx.gas === verified.gasLimit && tx.maxFeePerGas === verified.maxFeePerGas && tx.maxPriorityFeePerGas === verified.maxPriorityFeePerGas
      && tx.blockNumber === receipt.blockNumber && tx.blockHash === receipt.blockHash && tx.transactionIndex === receipt.transactionIndex
      && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0
      && uint(receipt.gasUsed) > 0n && receipt.gasUsed <= verified.gasLimit
      && uint(receipt.effectiveGasPrice) > 0n && receipt.effectiveGasPrice <= verified.maxFeePerGas);
    const number = uint(receipt.blockNumber), blockHash = bytes32(receipt.blockHash);
    demand(number >= parent.deploymentBlockNumber && number <= parent.finalizedBlock.number, "reward_lifecycle_not_finalized");
    const block = await reader.getBlock({ blockNumber: number });
    check(block.number === number && block.hash === blockHash && block.timestamp <= parent.finalizedBlock.timestamp
      && (number !== parent.finalizedBlock.number || (blockHash === parent.finalizedBlock.hash && block.timestamp === parent.finalizedBlock.timestamp)));
    const expectedEvents = events(p, block.timestamp);
    demand(Array.isArray(receipt.logs) && receipt.logs.length === expectedEvents.length, "reward_lifecycle_event_mismatch");
    for (const [i, expected] of expectedEvents.entries()) {
      const log = receipt.logs[i]!;
      demand(log.removed === false && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0
        && (i === 0 || log.logIndex === receipt.logs[i - 1]!.logIndex + 1) && log.transactionHash === hash
        && log.transactionIndex === receipt.transactionIndex && log.blockNumber === number && log.blockHash === blockHash
        && walletAddress(log.address) === encoded.to && log.data.toLowerCase() === expected.data
        && log.topics.length === expected.topics.length && log.topics.every((t, k) => t.toLowerCase() === expected.topics[k]),
      "reward_lifecycle_event_mismatch");
    }
    const state = await readState(reader, p, number), a = state.accounting;
    prefix(p, state);
    check(a.budgets[p.child.enabledPot] === p.child.budgetWei && a.state !== 0);
    if (p.action === "upload_awards") check(a.entitlementCount >= BigInt(p.batchStart + p.batchSize));
    if (p.action === "stage_allocation" || p.action === "activate") {
      staged(p, state, block.timestamp);
      if (p.action === "stage_allocation") check(a.activationNotBefore === block.timestamp);
      else check(a.claimDeadline >= block.timestamp + 31536000n && (a.state === 3 || a.state === 4));
    }
    await recheck(reader, p, parent, { number, hash: blockHash, timestamp: block.timestamp });
    return { protocolVersion: 3 as const, provenance: { kind: "programme-child" as const, programmeAddress: parent.context.verifyingContract,
      deploymentTransactionHash: parent.deploymentTransactionHash, slot: p.slot }, action: p.action, campaignAddress: encoded.to,
      transactionHash: hash, nonce: p.nonce, blockNumber: number, blockHash, blockTimestamp: block.timestamp,
      gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, feeWei: receipt.gasUsed * receipt.effectiveGasPrice,
      finalizedBlock: parent.finalizedBlock, accountingAtReceiptBlock: a, publicationAtReceiptBlock: state.publication };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_lifecycle_observation_unavailable");
  }
}
