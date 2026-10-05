// Programme/factory provenance is distinct from the historical direct-CREATE
// campaign reader. No wallet, database, endpoint discovery or signing capability.
import { decodeEventLog, encodeDeployData, getContractAddress, keccak256, padHex, parseAbi, toHex,
  type Address, type Hex, type PublicClient } from "viem";
import { rewardCampaignV3Abi } from "./campaign-v3.js";
import { verifyRewardRuntimeV3 } from "./deployment-v3.js";
import { bytes32, demand, rewardChainContext, RewardProtocolError, uint, walletAddress, type RewardChainContext } from "./validation.js";

export const rewardProgrammeV3Abi = parseAbi([
  "constructor(address funder_,address operator_,bytes32 programmeId_,bytes32 manifestHash_,uint256 budget_,bytes32[6] campaignIds,uint64[6] reviewPeriods)",
  "function PROTOCOL_VERSION() view returns (uint256)", "function POT_COUNT() view returns (uint256)",
  "function funder() view returns (address)", "function operator() view returns (address)",
  "function programmeId() view returns (bytes32)", "function programmeManifestHash() view returns (bytes32)",
  "function budget() view returns (uint256)", "function campaigns(uint256) view returns (address)",
  "function caps(uint256) view returns (uint256)", "function routed(uint256) view returns (bool)",
  "function returnedByPot(uint256) view returns (uint256)", "function deposited() view returns (uint256)",
  "function totalRouted() view returns (uint256)", "function unroutedRefunded() view returns (uint256)",
  "function returned() view returns (uint256)", "function returnsWithdrawn() view returns (uint256)",
  "function fundingAborted() view returns (bool)", "function pendingFunding() view returns (uint256)",
  "function pendingReturns() view returns (uint256)", "function deposit(uint256 expectedDeposited) payable",
  "function routePot(uint8 slot)", "function abortFunding()", "function refundUnrouted()",
  "function withdrawReturns(uint256 expectedReturned)", "function withdrawSurplus()",
  "event CampaignCreated(uint8 indexed slot,address indexed campaign,bytes32 campaignId,uint256 cap,uint64 review)",
  "event Deposited(address indexed funder,uint256 amount,uint256 total)",
  "event PotRouted(uint8 indexed slot,address indexed campaign,uint256 amount)",
  "event FundingAborted()", "event UnroutedRefunded(uint256 amount)",
  "event ReturnReceived(uint8 indexed slot,uint256 amount,uint256 total)",
  "event ReturnsWithdrawn(uint256 amount)", "event SurplusWithdrawn(uint256 amount)",
]);
export const rewardProgrammeV3Build = Object.freeze({
  creationCodeHash: "0x224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4" as Hex,
  runtimeTemplateHash: "0x178780b7733d095bd6b5eefafc97e040ce9db78c9df69ccb7a2d33e6377cb5f5" as Hex,
  creationBytes: 16869, runtimeBytes: 3863,
});
const immutables = { funderAddress: [1429,1660,2040,2264,2790,2939,3244,3539], operatorAddress: [804,2673],
  programmeId: [1559], programmeManifestHash: [1979], budgetWei: [726,1849] } as const;
export type RewardProgrammePlanV3 = {
  context: RewardChainContext; funderAddress: Address; operatorAddress: Address;
  programmeId: Hex; programmeManifestHash: Hex; budgetWei: bigint;
  campaignIds: readonly Hex[]; reviewPeriods: readonly bigint[];
  deploymentNonce: bigint;
};
export type RewardProgrammeExpectationV3 = RewardProgrammePlanV3 & { deploymentTransactionHash: Hex };
function check(ok: unknown): asserts ok { demand(ok, "invalid_reward_programme_v3"); }

export function normalizeRewardProgrammePlanV3(input: RewardProgrammePlanV3): RewardProgrammePlanV3 {
  const context = rewardChainContext(input.context), funderAddress = walletAddress(input.funderAddress), operatorAddress = walletAddress(input.operatorAddress);
  const budgetWei = uint(input.budgetWei), deploymentNonce = uint(input.deploymentNonce, 64);
  demand(deploymentNonce <= BigInt(Number.MAX_SAFE_INTEGER), "reward_deployment_nonce_exhausted");
  demand(budgetWei > 0n && budgetWei % 10n === 0n, "invalid_reward_programme_budget");
  demand(funderAddress !== operatorAddress && funderAddress !== context.verifyingContract && operatorAddress !== context.verifyingContract,
    "invalid_reward_programme_roles");
  demand(Array.isArray(input.campaignIds) && input.campaignIds.length === 6 && Array.isArray(input.reviewPeriods) && input.reviewPeriods.length === 6,
    "invalid_reward_programme_slots");
  const campaignIds = input.campaignIds.map(id => bytes32(id)), reviewPeriods = input.reviewPeriods.map(p => uint(p, 64));
  demand(new Set(campaignIds).size === 6 && reviewPeriods.every(p => p <= 2592000n), "invalid_reward_programme_slots");
  demand(getContractAddress({ from: operatorAddress, nonce: deploymentNonce }) === context.verifyingContract, "reward_deployment_address_mismatch");
  return { context, funderAddress, operatorAddress, budgetWei, deploymentNonce, campaignIds, reviewPeriods,
    programmeId: bytes32(input.programmeId), programmeManifestHash: bytes32(input.programmeManifestHash) };
}
export function normalizeRewardProgrammeV3(input: RewardProgrammeExpectationV3): RewardProgrammeExpectationV3 {
  return { ...normalizeRewardProgrammePlanV3(input), deploymentTransactionHash: bytes32(input.deploymentTransactionHash) };
}
export function requireRewardProgrammeCreationV3(code: Hex): Hex {
  demand(typeof code === "string" && /^0x[0-9a-fA-F]+$/.test(code) && code.length === 2 + 2 * rewardProgrammeV3Build.creationBytes
    && keccak256(code) === rewardProgrammeV3Build.creationCodeHash, "reward_programme_creation_mismatch");
  return code.toLowerCase() as Hex;
}
export function encodeRewardProgrammeDeploymentV3(input: RewardProgrammePlanV3, code: Hex): Hex {
  const s = normalizeRewardProgrammePlanV3(input);
  return encodeDeployData({ abi: rewardProgrammeV3Abi, bytecode: requireRewardProgrammeCreationV3(code), args: [s.funderAddress, s.operatorAddress,
    s.programmeId, s.programmeManifestHash, s.budgetWei, s.campaignIds as [Hex,Hex,Hex,Hex,Hex,Hex], s.reviewPeriods as [bigint,bigint,bigint,bigint,bigint,bigint]] });
}
export function verifyRewardProgrammeRuntimeV3(input: RewardProgrammeExpectationV3, code: Hex): Hex {
  const s = normalizeRewardProgrammeV3(input);
  demand(typeof code === "string" && /^0x[0-9a-fA-F]+$/.test(code) && code.length === 2 + 2 * rewardProgrammeV3Build.runtimeBytes,
    "reward_programme_runtime_mismatch");
  let template = code.toLowerCase();
  for (const [name, offsets] of Object.entries(immutables)) {
    const value = name === "budgetWei" ? toHex(s.budgetWei, { size: 32 }) : padHex(s[name as "funderAddress" | "operatorAddress" | "programmeId" | "programmeManifestHash"]);
    for (const offset of offsets) {
      const at = 2 + offset * 2;
      demand(template.slice(at, at + 64) === value.slice(2).toLowerCase(), "reward_programme_immutable_mismatch");
      template = template.slice(0, at) + "0".repeat(64) + template.slice(at + 64);
    }
  }
  demand(keccak256(template as Hex) === rewardProgrammeV3Build.runtimeTemplateHash, "reward_programme_runtime_mismatch");
  return keccak256(code);
}
export function rewardProgrammeChildV3(input: RewardProgrammePlanV3, slot: number) {
  const s = normalizeRewardProgrammePlanV3(input);
  demand(Number.isInteger(slot) && slot >= 0 && slot < 6, "invalid_reward_programme_slot");
  return { context: { ...s.context, verifyingContract: getContractAddress({ from: s.context.verifyingContract, nonce: BigInt(slot + 1) }) },
    operatorAddress: s.operatorAddress, treasuryAddress: s.context.verifyingContract, programmeId: s.programmeId,
    campaignId: s.campaignIds[slot]!, programmeManifestHash: s.programmeManifestHash,
    enabledPot: (slot === 5 ? 1 : 0) as 0 | 1, reviewPeriod: s.reviewPeriods[slot]!, budgetWei: slot === 5 ? s.budgetWei / 2n : s.budgetWei / 10n };
}
export type RewardProgrammeReaderV3 = Pick<PublicClient, "getChainId" | "getBlock" | "getTransaction" | "getTransactionReceipt" | "getCode" | "readContract" | "getBalance">;

/** Full pinned factory provenance AND one finalized funding checkpoint. Registry
 * expectations must be organizer-approved server data, never request-body claims.
 * This does not grant payout authority or prove publication/source verification. */
export async function readVerifiedRewardProgrammeV3(reader: RewardProgrammeReaderV3, input: RewardProgrammeExpectationV3) {
  const s = normalizeRewardProgrammeV3(input); // Capture every value before I/O.
  try {
    check(await reader.getChainId() === s.context.chainId);
    const final = await reader.getBlock({ blockTag: "finalized" });
    check(final.number !== null && final.hash !== null && final.timestamp > 0n);
    const blockNumber = uint(final.number), blockHash = bytes32(final.hash);
    const [tx, receipt] = await Promise.all([reader.getTransaction({ hash: s.deploymentTransactionHash }), reader.getTransactionReceipt({ hash: s.deploymentTransactionHash })]);
    check(tx.hash === s.deploymentTransactionHash && receipt.transactionHash === tx.hash && receipt.status === "success"
      && tx.to === null && receipt.to === null && tx.value === 0n && tx.chainId === s.context.chainId
      && walletAddress(tx.from) === s.operatorAddress && walletAddress(receipt.from) === s.operatorAddress
      && BigInt(tx.nonce) === s.deploymentNonce && receipt.contractAddress != null && walletAddress(receipt.contractAddress) === s.context.verifyingContract
      && tx.blockNumber === receipt.blockNumber && tx.blockHash === receipt.blockHash && tx.transactionIndex === receipt.transactionIndex
      && receipt.blockNumber <= blockNumber && receipt.gasUsed > 0n && receipt.gasUsed <= tx.gas && tx.gas <= 30000000n);
    const creation = requireRewardProgrammeCreationV3(tx.input.slice(0, 2 + rewardProgrammeV3Build.creationBytes * 2) as Hex);
    check(tx.input.toLowerCase() === encodeRewardProgrammeDeploymentV3(s, creation));
    const deploymentBlock = await reader.getBlock({ blockNumber: receipt.blockNumber });
    check(deploymentBlock.number === receipt.blockNumber && deploymentBlock.hash === receipt.blockHash);
    check(receipt.logs.length === 6);
    for (let slot = 0; slot < 6; slot++) {
      const log = receipt.logs[slot]!, child = rewardProgrammeChildV3(s, slot);
      check(!log.removed && walletAddress(log.address) === s.context.verifyingContract && log.transactionHash === tx.hash && log.blockHash === receipt.blockHash
        && log.blockNumber === receipt.blockNumber && log.transactionIndex === receipt.transactionIndex
        && (slot === 0 || log.logIndex > receipt.logs[slot - 1]!.logIndex));
      const event = decodeEventLog({ abi: rewardProgrammeV3Abi, data: log.data, topics: log.topics });
      check(event.eventName === "CampaignCreated");
      check(event.args.slot === slot && walletAddress(event.args.campaign) === child.context.verifyingContract
        && event.args.campaignId === child.campaignId && event.args.cap === child.budgetWei && event.args.review === child.reviewPeriod);
    }
    const address = s.context.verifyingContract;
    const [code, balance] = await Promise.all([reader.getCode({ address, blockNumber }), reader.getBalance({ address, blockNumber })]);
    check(code !== undefined);
    const runtimeCodeHash = verifyRewardProgrammeRuntimeV3(s, code);
    const read = (functionName: "deposited" | "totalRouted" | "unroutedRefunded" | "returned" | "returnsWithdrawn" | "pendingFunding" | "pendingReturns" | "fundingAborted") =>
      reader.readContract({ address, abi: rewardProgrammeV3Abi, functionName, blockNumber });
    const raw = await Promise.all([read("deposited"), read("totalRouted"), read("unroutedRefunded"), read("returned"), read("returnsWithdrawn"), read("pendingFunding"), read("pendingReturns"), read("fundingAborted")]);
    check(raw.slice(0, 7).every(v => typeof v === "bigint") && typeof raw[7] === "boolean");
    const [deposited, totalRouted, unroutedRefunded, returned, returnsWithdrawn, pendingFunding, pendingReturns] = raw.slice(0, 7).map(v => uint(v as bigint));
    const fundingAborted = raw[7] as boolean;
    check(deposited! <= s.budgetWei && totalRouted! + unroutedRefunded! + pendingFunding! === deposited
      && returnsWithdrawn! + pendingReturns! === returned && uint(balance) >= pendingFunding! + pendingReturns!
      && (fundingAborted || unroutedRefunded === 0n));
    // Sequential slots prevent an unbounded burst of public RPC reads. The
    // worker owns provider pacing; this reader never retries or changes endpoint.
    const pots = [];
    for (let slot = 0; slot < 6; slot++) {
      const child = rewardProgrammeChildV3(s, slot), childAddress = child.context.verifyingContract;
      const [actualAddress, cap, routed, returnedByPot] = await Promise.all([
        reader.readContract({ address, abi: rewardProgrammeV3Abi, functionName: "campaigns", args: [BigInt(slot)], blockNumber }),
        reader.readContract({ address, abi: rewardProgrammeV3Abi, functionName: "caps", args: [BigInt(slot)], blockNumber }),
        reader.readContract({ address, abi: rewardProgrammeV3Abi, functionName: "routed", args: [BigInt(slot)], blockNumber }),
        reader.readContract({ address, abi: rewardProgrammeV3Abi, functionName: "returnedByPot", args: [BigInt(slot)], blockNumber }),
      ]);
      check(walletAddress(actualAddress) === childAddress && cap === child.budgetWei && typeof routed === "boolean");
      const [childCode, childBalance, state, paused, accountedFunding, treasuryReturned] = await Promise.all([
        reader.getCode({ address: childAddress, blockNumber }), reader.getBalance({ address: childAddress, blockNumber }),
        reader.readContract({ address: childAddress, abi: rewardCampaignV3Abi, functionName: "state", blockNumber }),
        reader.readContract({ address: childAddress, abi: rewardCampaignV3Abi, functionName: "paused", blockNumber }),
        reader.readContract({ address: childAddress, abi: rewardCampaignV3Abi, functionName: "accountedFunding", blockNumber }),
        reader.readContract({ address: childAddress, abi: rewardCampaignV3Abi, functionName: "treasuryReturned", blockNumber }),
      ]);
      check(childCode !== undefined);
      verifyRewardRuntimeV3(child, childCode);
      const values = await Promise.all((["budgets", "allocated", "paid"] as const).flatMap(functionName => [0n, 1n].map(i =>
        reader.readContract({ address: childAddress, abi: rewardCampaignV3Abi, functionName, args: [i], blockNumber }))));
      const [raceBudget, leagueBudget, raceAllocated, leagueAllocated, racePaid, leaguePaid] = values.map(v => uint(v));
      const b = slot === 5 ? leagueBudget! : raceBudget!, a = slot === 5 ? leagueAllocated! : raceAllocated!, p = slot === 5 ? leaguePaid! : racePaid!;
      check(Number.isInteger(state) && state >= 0 && state <= 5 && typeof paused === "boolean" && (!paused || state === 3)
        && accountedFunding === (routed ? cap : 0n) && p <= a && a <= b && (b === 0n || b === cap)
        && (slot === 5 ? raceBudget === 0n && raceAllocated === 0n && racePaid === 0n : leagueBudget === 0n && leagueAllocated === 0n && leaguePaid === 0n)
        && p + uint(treasuryReturned) <= accountedFunding && uint(childBalance) >= accountedFunding - p - treasuryReturned
        && uint(returnedByPot) >= treasuryReturned && (returnedByPot === 0n || state === 4 || state === 5)
        && (state === 0 ? b === 0n && a === 0n && p === 0n : state === 5 || b === cap)
        && (state === 3 || state === 4 || p === 0n));
      pots.push({ slot, address: childAddress, capWei: cap, routed, state, paused, accountedFundingWei: accountedFunding,
        allocatedWei: a, paidWei: p, treasuryReturnedWei: treasuryReturned, returnedToProgrammeWei: returnedByPot,
        balanceWei: childBalance, remainingWei: accountedFunding - p - treasuryReturned });
    }
    check(pots.reduce((v, p) => v + (p.routed ? p.capWei : 0n), 0n) === totalRouted
      && pots.reduce((v, p) => v + p.returnedToProgrammeWei, 0n) === returned);
    const [chainAfter, finalAfter, anchorAfter, deployAfter] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
      reader.getBlock({ blockNumber }), reader.getBlock({ blockNumber: receipt.blockNumber })]);
    check(chainAfter === s.context.chainId && finalAfter.number !== null && finalAfter.number >= blockNumber
      && finalAfter.hash !== null && (finalAfter.number !== blockNumber || finalAfter.hash === blockHash)
      && anchorAfter.number === blockNumber && anchorAfter.hash === blockHash && anchorAfter.timestamp === final.timestamp
      && deployAfter.number === receipt.blockNumber && deployAfter.hash === receipt.blockHash);
    return { protocolVersion: 3 as const, context: s.context, programmeId: s.programmeId, programmeManifestHash: s.programmeManifestHash,
      funderAddress: s.funderAddress, operatorAddress: s.operatorAddress, budgetWei: s.budgetWei, runtimeCodeHash,
      deploymentTransactionHash: tx.hash, deploymentBlockNumber: receipt.blockNumber, deploymentBlockHash: receipt.blockHash,
      finalizedBlock: { number: blockNumber, hash: blockHash, timestamp: final.timestamp },
      depositedWei: deposited!, totalRoutedWei: totalRouted!, unroutedRefundedWei: unroutedRefunded!, returnedWei: returned!,
      returnsWithdrawnWei: returnsWithdrawn!, pendingFundingWei: pendingFunding!, pendingReturnsWei: pendingReturns!, fundingAborted,
      balanceWei: balance, surplusWei: balance - pendingFunding! - pendingReturns!, pots };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_programme_observation_unavailable");
  }
}
