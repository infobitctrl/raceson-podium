import { hashTypedData, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { rewardClaimDigests, rewardClaimMessages, safeRewardConsentMessage, type RewardClaim } from "./claims.js";
import { rewardClaimDigestsV3, rewardClaimMessagesV3, safeRewardConsentMessageV3 } from "./campaign-v3.js";
import { sponsorClaimDigestsV4, sponsorClaimMessagesV4, sponsorSafeConsentMessageV4 } from "./sponsor-claims-v4.js";
import { bytes32, demand, rewardChainContext, RewardProtocolError, signatureBytes, uint, walletAddress, type RewardChainContext } from "./validation.js";

/** Original @safe-global/safe-contracts@1.4.1-2 artifacts; not SafeL2, another
 * release, or a version-string allowlist. Source SHA-256 pins are tested too. */
export const rewardClubSafeBuild = Object.freeze({
  id: "safe-1.4.1-original-2-of-3-v1", version: "1.4.1",
  proxy: Object.freeze({ bytes: 171, hash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" }),
  singleton: Object.freeze({ bytes: 23579, hash: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4" }),
  handler: Object.freeze({ bytes: 5637, hash: "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9" }),
} as const);
export const rewardClubSafeSlots = Object.freeze({
  singleton: `0x${"00".repeat(32)}` as Hex,
  fallbackHandler: "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex,
  guard: "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as Hex,
});
export const rewardClubSafeAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
  "function getMessageHash(bytes message) view returns (bytes32)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const sentinel = "0x0000000000000000000000000000000000000001" as Address;
export type RewardClubSafeExpectation = {
  /** verifyingContract is the Safe, not the reward campaign. */
  context: RewardChainContext; singletonAddress: Address; fallbackHandlerAddress: Address; owners: readonly Address[];
};
export type RewardClubSafeReader = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "getStorageAt" | "readContract">;
export type RewardSafeBlock = { number: bigint; hash: Hex; timestamp: bigint };

function ownerSet(values: readonly Address[], safe: Address) {
  demand(Array.isArray(values) && values.length === 3, "reward_club_three_owners_required");
  const owners = Array.from(values, value => walletAddress(value).toLowerCase() as Address).sort();
  demand(new Set(owners).size === 3 && owners.every(owner => owner !== sentinel && owner !== safe.toLowerCase()), "reward_club_invalid_owners");
  return owners;
}
export function normalizeRewardClubSafeExpectation(input: RewardClubSafeExpectation) {
  const context = rewardChainContext(input.context), singletonAddress = walletAddress(input.singletonAddress), fallbackHandlerAddress = walletAddress(input.fallbackHandlerAddress);
  demand(new Set([context.verifyingContract, singletonAddress, fallbackHandlerAddress].map(a => a.toLowerCase())).size === 3,
    "reward_club_safe_address_mismatch");
  return { context, singletonAddress, fallbackHandlerAddress, owners: ownerSet(input.owners, context.verifyingContract) };
}
function block(input: RewardSafeBlock): RewardSafeBlock {
  return { number: uint(input.number), hash: bytes32(input.hash), timestamp: uint(input.timestamp) };
}
function code(value: Hex | undefined, pin: { bytes: number; hash: string }, reason: string) {
  demand(typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) && value.length === 2 + pin.bytes * 2 && keccak256(value) === pin.hash, reason);
}
function storageAddress(value: Hex | undefined) {
  demand(typeof value === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(value), "reward_club_invalid_storage");
  return `0x${value.slice(-40).toLowerCase()}`;
}
async function recheck(reader: RewardClubSafeReader, chainId: number, at: RewardSafeBlock, floor = at) {
  const [chain, finality, canonical] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber: at.number })]);
  demand(chain === chainId, "reward_observed_chain_mismatch");
  demand(finality.number !== null && finality.hash !== null && uint(finality.number) >= floor.number && uint(finality.timestamp) >= floor.timestamp,
    "reward_finality_regressed");
  demand(canonical.number === at.number && canonical.hash !== null && bytes32(canonical.hash) === at.hash && canonical.timestamp === at.timestamp
    && (finality.number !== at.number || (bytes32(finality.hash) === at.hash && finality.timestamp === at.timestamp)), "reward_chain_changed_during_observation");
}

/** Injected trusted-worker reads only, never browser-supplied observations. An
 * optional checkpoint composes with a reward's same-block unpaid-award read.
 * This verifies the observed configuration, not deployment/setup provenance,
 * club identity, independent owner control or absence of hidden storage entries.
 * See CLUB-SAFES.md before using the observation in a treasury approval. */
export async function readVerifiedRewardClubSafe(reader: RewardClubSafeReader, input: RewardClubSafeExpectation, checkpoint?: RewardSafeBlock) {
  const expected = normalizeRewardClubSafeExpectation(input), requested = checkpoint ? block(checkpoint) : null;
  try {
    demand(await reader.getChainId() === expected.context.chainId, "reward_observed_chain_mismatch");
    const finalized = await reader.getBlock({ blockTag: "finalized" });
    demand(finalized.number !== null && finalized.hash !== null, "reward_finalized_block_missing");
    const f = block({ number: finalized.number, hash: finalized.hash, timestamp: finalized.timestamp }), at = requested ?? f;
    demand(at.number <= f.number && at.timestamp <= f.timestamp, "reward_club_checkpoint_not_finalized");
    const address = expected.context.verifyingContract, blockNumber = at.number;
    const [proxyCode, singletonCode, handlerCode, singletonWord, handlerWord, guardWord] = await Promise.all([
      reader.getCode({ address, blockNumber }), reader.getCode({ address: expected.singletonAddress, blockNumber }),
      reader.getCode({ address: expected.fallbackHandlerAddress, blockNumber }),
      reader.getStorageAt({ address, slot: rewardClubSafeSlots.singleton, blockNumber }),
      reader.getStorageAt({ address, slot: rewardClubSafeSlots.fallbackHandler, blockNumber }),
      reader.getStorageAt({ address, slot: rewardClubSafeSlots.guard, blockNumber }),
    ]);
    code(proxyCode, rewardClubSafeBuild.proxy, "reward_club_proxy_code_mismatch");
    code(singletonCode, rewardClubSafeBuild.singleton, "reward_club_singleton_code_mismatch");
    code(handlerCode, rewardClubSafeBuild.handler, "reward_club_handler_code_mismatch");
    demand(storageAddress(singletonWord) === expected.singletonAddress.toLowerCase(), "reward_club_singleton_mismatch");
    demand(storageAddress(handlerWord) === expected.fallbackHandlerAddress.toLowerCase(), "reward_club_handler_mismatch");
    // Extra execution routes/guards require a separately reviewed policy. Never
    // disable them, assume they preserve effective 2-of-3, or enumerate forever.
    demand(BigInt(storageAddress(guardWord)) === 0n, "reward_club_guard_not_supported");
    const read = <N extends "VERSION" | "getThreshold" | "getOwners">(functionName: N) => reader.readContract({ address, abi: rewardClubSafeAbi, functionName, blockNumber });
    const [version, threshold, owners, modules] = await Promise.all([
      read("VERSION"), read("getThreshold"), read("getOwners"),
      reader.readContract({ address, abi: rewardClubSafeAbi, functionName: "getModulesPaginated", args: [sentinel, 1n], blockNumber }),
    ]);
    demand(version === rewardClubSafeBuild.version, "reward_club_safe_version_mismatch");
    demand(threshold === 2n, "reward_club_two_signatures_required");
    const actualOwners = ownerSet(owners, address);
    demand(actualOwners.every((owner, i) => owner === expected.owners[i]), "reward_club_owners_changed");
    demand(modules[0].length === 0 && walletAddress(modules[1]).toLowerCase() === sentinel, "reward_club_modules_not_supported");
    await recheck(reader, expected.context.chainId, at, f);
    return { buildId: rewardClubSafeBuild.id, ...expected, threshold: 2 as const, modules: [] as Address[], guard: null, finalizedBlock: at, observedFinalizedHead: f };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_safe_observation_unavailable");
  }
}

/** Checks the campaign's exact ReceiveReward-v2 digest through the pinned Safe
 * handler at one finalized checkpoint. It does not sign, approve, queue or pay. */
type RewardClubSafeConsentInput = {
  safe: RewardClubSafeExpectation; campaignContext: RewardChainContext; claim: RewardClaim; signature: Hex; checkpoint?: RewardSafeBlock;
};
export async function verifyRewardClubSafeConsent(reader: RewardClubSafeReader, input: RewardClubSafeConsentInput) {
  return verifySafeConsent(reader, input, 1);
}
/** Separate V3 entry: the Safe wraps ReceiveReward domain version 4. Never
 * accept a caller-selected domain/version or downgrade to historical consent. */
export async function verifyRewardClubSafeConsentV3(reader: RewardClubSafeReader, input: RewardClubSafeConsentInput) {
  return { protocolVersion: 3 as const, ...await verifySafeConsent(reader, input, 3) };
}
/** V4 Safe consent wraps only domain version 5. */
export async function verifySponsorClubSafeConsentV4(reader: RewardClubSafeReader, input: RewardClubSafeConsentInput) {
  return { protocolVersion: 4 as const, ...await verifySafeConsent(reader, input, 4) };
}
async function verifySafeConsent(reader: RewardClubSafeReader, input: RewardClubSafeConsentInput, protocol: 1 | 3 | 4) {
  const safe = normalizeRewardClubSafeExpectation(input.safe), campaignContext = rewardChainContext(input.campaignContext), claim = { ...input.claim }, signature = signatureBytes(input.signature);
  const checkpoint = input.checkpoint ? block(input.checkpoint) : undefined;
  if (protocol === 4) sponsorClaimMessagesV4(campaignContext, claim); else if (protocol === 3) rewardClaimMessagesV3(campaignContext, claim); else rewardClaimMessages(campaignContext, claim);
  demand(campaignContext.chainId === safe.context.chainId && campaignContext.environment === safe.context.environment
    && walletAddress(claim.recipient) === safe.context.verifyingContract && campaignContext.verifyingContract !== safe.context.verifyingContract, "reward_club_consent_scope_mismatch");
  const message = protocol === 4 ? sponsorSafeConsentMessageV4(campaignContext, claim) : protocol === 3 ? safeRewardConsentMessageV3(campaignContext, claim) : safeRewardConsentMessage(campaignContext, claim);
  const digest = (protocol === 4 ? sponsorClaimDigestsV4 : protocol === 3 ? rewardClaimDigestsV3 : rewardClaimDigests)(campaignContext, claim).consent;
  try {
    const observation = await readVerifiedRewardClubSafe(reader, safe, checkpoint), at = observation.finalizedBlock;
    demand(claim.issuedAt <= at.timestamp && at.timestamp < claim.expiresAt, "reward_claim_not_live");
    const [wrappedHash, magic] = await Promise.all([
      reader.readContract({ address: safe.context.verifyingContract, abi: rewardClubSafeAbi, functionName: "getMessageHash", args: [message.message.message], blockNumber: at.number }),
      reader.readContract({ address: safe.context.verifyingContract, abi: rewardClubSafeAbi, functionName: "isValidSignature", args: [digest, signature], blockNumber: at.number }),
    ]);
    demand(bytes32(wrappedHash) === hashTypedData(message), "reward_club_consent_wrapper_mismatch");
    demand(magic === "0x1626ba7e", "reward_club_consent_invalid");
    await recheck(reader, safe.context.chainId, at, observation.observedFinalizedHead);
    return { observation, role: "recipient" as const, signer: safe.context.verifyingContract, digest, wrappedDigest: hashTypedData(message), signature };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_club_consent_observation_unavailable");
  }
}
