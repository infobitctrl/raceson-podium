/** Public, synthetic trial only. No signer, session, athlete or provider secret. */
export const contractCanaryPlan = Object.freeze({
  schema: "raceson-contract-canary-plan-v1", network: "Monad testnet", chainId: 10143,
  description: "Isolated synthetic contract canary, not sporting results or real athlete awards",
  funder: "0xA768aD0500ee7536C2583C1953377efF561eC98b",
  operator: "0x4c5616771FFce5Fc41BcB4A30dd2B55AAc8EBE31",
  relayer: "0x6c215b3052588f4B3bcB957bF4A1B0aaF38771Ec",
  deploymentNonce: "0", pot: "race", budgetMON: "1", singleClaimMON: "0.1",
  walletlessReserveMON: "0.4", unallocatedMON: "0.5", reviewSeconds: 86400,
  operatorTopUpMON: "2", relayerTopUpMON: "0.1",
  feeCeilingPerGasWei: "200000000000", deploymentGasLimitCeiling: "4000000",
  operatorTotalFeeCeilingMON: "1", relayerTotalFeeCeilingMON: "0.1", funderTopUpFeeCeilingMON: "0.02",
  deploymentArtifact: "RacesOnRewardCampaignV2", buildId: "raceson-reward-campaign-v2-review24h-solc-0.8.36-cancun-ir-200",
  creationCodeHash: "0xcc22186ff9db469522d76f93a9fc4888d97c885120dd95950f192895ef22f948",
  recipientPolicy: "A separate owner-controlled external test wallet must be supplied and prove consent before a claim; no generated athlete keys",
  approval: "required; preparing or observing this plan does not grant execution authority",
});
export const CANARY_MANIFEST = "0x5517164fe44332ab23819ef3cb21615fcb3a4447cc5f04ccf15ffbe243d39f12";
export const CANARY_CONNECTIVITY_TX = "0x11a93252f730bae7b20be95635fa67b6309dd980eabddedcb8d371bf9ef8d56c";
export type CanaryRole = "funder" | "operator" | "relayer";
export type CanaryStatus = {
  schema: "raceson-canary-status-v1"; chainId: 10143; manifestHash: string;
  observedBlock: { number: string; hash: string; timestamp: string };
  wallets: { role: CanaryRole; address: string; balanceWei: string }[];
  deployment: "absent" | "unverified" | "verified";
  contract: null | { address: string; transactionHash: string; state: number; paused: boolean;
    fundedWei: string; allocatedWei: string; paidWei: string; returnedWei: string; balanceWei: string;
    reviewStartedAt: string | null; reviewDeadline: string | null };
};
const fail = (): never => { throw new Error("invalid_canary_status"); };
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || !keys.every(k => Object.hasOwn(r, k))) return fail();
  return r;
}
function uint(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n) return fail();
  return value;
}
function hex(value: unknown, length: number): string {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${length}}$`).test(value) || BigInt(value) === 0n) return fail();
  return value;
}
export function decodeCanaryStatus(value: unknown): CanaryStatus {
  const r = record(value, ["schema", "chainId", "manifestHash", "observedBlock", "wallets", "deployment", "contract"]);
  if (r.schema !== "raceson-canary-status-v1" || r.chainId !== 10143 || r.manifestHash !== CANARY_MANIFEST
    || !["absent", "unverified", "verified"].includes(String(r.deployment))) return fail();
  const b = record(r.observedBlock, ["number", "hash", "timestamp"]);
  const observedBlock = { number: uint(b.number), hash: hex(b.hash, 64), timestamp: uint(b.timestamp) };
  if (BigInt(observedBlock.timestamp) < 1n || BigInt(observedBlock.timestamp) > 253402300799n) return fail();
  if (!Array.isArray(r.wallets) || r.wallets.length !== 3) return fail();
  const wallets = r.wallets.map((value, i) => {
    const w = record(value, ["role", "address", "balanceWei"]), role = (["funder", "operator", "relayer"] as const)[i];
    if (w.role !== role || w.address !== contractCanaryPlan[role]) return fail();
    return { role, address: contractCanaryPlan[role], balanceWei: uint(w.balanceWei) };
  });
  let contract: CanaryStatus["contract"] = null;
  if (r.deployment === "verified") {
    const c = record(r.contract, ["address", "transactionHash", "state", "paused", "fundedWei", "allocatedWei", "paidWei", "returnedWei",
      "balanceWei", "reviewStartedAt", "reviewDeadline"]);
    if (c.address !== "0x050Ca3D328F8283CaE4B300567CCa54cF254282B" || !Number.isInteger(c.state)
      || Number(c.state) < 0 || Number(c.state) > 5 || typeof c.paused !== "boolean") return fail();
    contract = { address: c.address, transactionHash: hex(c.transactionHash, 64), state: Number(c.state), paused: c.paused,
      fundedWei: uint(c.fundedWei), allocatedWei: uint(c.allocatedWei), paidWei: uint(c.paidWei),
      returnedWei: uint(c.returnedWei), balanceWei: uint(c.balanceWei),
      reviewStartedAt: c.reviewStartedAt === null ? null : uint(c.reviewStartedAt),
      reviewDeadline: c.reviewDeadline === null ? null : uint(c.reviewDeadline) };
    const funded = BigInt(contract.fundedWei), allocated = BigInt(contract.allocatedWei), paid = BigInt(contract.paidWei), returned = BigInt(contract.returnedWei);
    if (funded > 10n ** 18n || allocated > funded || paid > allocated || paid + returned > funded
      || BigInt(contract.balanceWei) < funded - paid - returned) return fail();
    if (contract.reviewStartedAt === null ? contract.reviewDeadline !== null
      : contract.reviewDeadline === null || BigInt(contract.reviewStartedAt) <= 0n
        || BigInt(contract.reviewDeadline) !== BigInt(contract.reviewStartedAt) + 86400n
        || BigInt(contract.reviewStartedAt) > BigInt(observedBlock.timestamp)) return fail();
    if ([2, 3, 4].includes(contract.state) && contract.reviewDeadline === null) return fail();
  } else if (r.contract !== null) return fail();
  return { schema: "raceson-canary-status-v1", chainId: 10143, manifestHash: CANARY_MANIFEST,
    observedBlock, wallets, deployment: r.deployment as CanaryStatus["deployment"], contract };
}
