import type { CanaryStatus } from "./canary.js";

/** Immutable public manifest of the deployed synthetic V3 trial. Keep its exact
 * property order/values: the deployment commits to JSON.stringify of this plan. */
export const finalResultsCanaryPlan = Object.freeze({
  label: "RacesOn final-publication V3 synthetic trial 2026-09-09",
  chainId: 10143, reviewSeconds: 0, budgetMON: "0.1", singleClaimMON: "0.01",
  walletlessReserveMON: "0.04", unallocatedMON: "0.05",
  operator: "0x4c5616771FFce5Fc41BcB4A30dd2B55AAc8EBE31",
  funder: "0xA768aD0500ee7536C2583C1953377efF561eC98b",
  relayer: "0x6c215b3052588f4B3bcB957bF4A1B0aaF38771Ec",
  deploymentNonce: 4, deploymentGasLimitCeiling: "4000000", feeCeilingPerGasWei: "200000000000",
  operatorTotalFeeCeilingMON: "0.5", funderTopUpFeeCeilingMON: "0",
  approval: "Owner authorized implementation and required test-MON funding on 2026-09-09; no recipient payout in this run",
  production: "untouched", existingV2: "unchanged; no reuse of its escrow or review clock",
});
export const FINAL_RESULTS_CANARY_MANIFEST = "0x7e566c3aad393f4278d9d208ba0222de06330615db996b1dc2b46ed0ae6d5222";
export const FINAL_RESULTS_CANARY_ADDRESS = "0x66Abd4113194441222763bd10e5df8ca5Bf1991E";
export const FINAL_RESULTS_CANARY_DEPLOYMENT_TX = "0xf0811a36f7e1b7fdf9d08af5cbded9dd1461215976cc692c4e28dcb1c01a5ec3";
export type FinalResultsCanaryStatus = Omit<CanaryStatus, "schema" | "deployment" | "contract"> & {
  schema: "raceson-final-results-canary-status-v3";
  deployment: "verified";
  contract: Omit<NonNullable<CanaryStatus["contract"]>, "reviewStartedAt" | "reviewDeadline"> & {
    reviewPeriodSeconds: "0";
    reviewStartedAt: string | null;
    officialPublishedAt: string | null;
    allocationApprovedAt: string | null;
  };
};
const fail = (): never => { throw new Error("invalid_final_results_canary_status"); };
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
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) return fail();
  return value;
}
/** Separate wire contract, not a V2 clock relabel. No key/session fields or
 * source-publication assertions are accepted. RPC verification is server-owned. */
export function decodeFinalResultsCanaryStatus(value: unknown): FinalResultsCanaryStatus {
  const r = record(value, ["schema", "chainId", "manifestHash", "observedBlock", "wallets", "deployment", "contract"]);
  if (r.schema !== "raceson-final-results-canary-status-v3" || r.chainId !== 10143
    || r.manifestHash !== FINAL_RESULTS_CANARY_MANIFEST || r.deployment !== "verified") return fail();
  const b = record(r.observedBlock, ["number", "hash", "timestamp"]);
  const observedBlock = { number: uint(b.number), hash: hash(b.hash), timestamp: uint(b.timestamp) };
  if (BigInt(observedBlock.timestamp) < 1n || BigInt(observedBlock.timestamp) > 253402300799n) return fail();
  if (!Array.isArray(r.wallets) || r.wallets.length !== 3) return fail();
  const wallets = r.wallets.map((value, i) => {
    const w = record(value, ["role", "address", "balanceWei"]), role = (["funder", "operator", "relayer"] as const)[i];
    if (w.role !== role || w.address !== finalResultsCanaryPlan[role]) return fail();
    return { role, address: finalResultsCanaryPlan[role], balanceWei: uint(w.balanceWei) };
  });
  const c = record(r.contract, ["address", "transactionHash", "state", "paused", "fundedWei", "allocatedWei", "paidWei", "returnedWei",
    "balanceWei", "reviewPeriodSeconds", "reviewStartedAt", "officialPublishedAt", "allocationApprovedAt"]);
  if (c.address !== FINAL_RESULTS_CANARY_ADDRESS || !Number.isInteger(c.state) || Number(c.state) < 0
    || Number(c.state) > 5 || typeof c.paused !== "boolean" || c.reviewPeriodSeconds !== "0") return fail();
  const contract: FinalResultsCanaryStatus["contract"] = {
    address: c.address, transactionHash: hash(c.transactionHash), state: Number(c.state), paused: c.paused,
    fundedWei: uint(c.fundedWei), allocatedWei: uint(c.allocatedWei), paidWei: uint(c.paidWei), returnedWei: uint(c.returnedWei),
    balanceWei: uint(c.balanceWei), reviewPeriodSeconds: "0",
    reviewStartedAt: c.reviewStartedAt === null ? null : uint(c.reviewStartedAt),
    officialPublishedAt: c.officialPublishedAt === null ? null : uint(c.officialPublishedAt),
    allocationApprovedAt: c.allocationApprovedAt === null ? null : uint(c.allocationApprovedAt),
  };
  const funded = BigInt(contract.fundedWei), allocated = BigInt(contract.allocatedWei), paid = BigInt(contract.paidWei), returned = BigInt(contract.returnedWei);
  if (funded > 10n ** 17n || allocated > funded || paid > allocated || paid + returned > funded
    || BigInt(contract.balanceWei) < funded - paid - returned) return fail();
  const { reviewStartedAt: start, officialPublishedAt: published, allocationApprovedAt: approved } = contract;
  if (start === null ? published !== null || approved !== null
    : published === null || approved === null || BigInt(start) < 1n || BigInt(published) < BigInt(start)
      || BigInt(approved) < BigInt(published) || BigInt(approved) > BigInt(observedBlock.timestamp)) return fail();
  if ([2, 3, 4].includes(contract.state) && approved === null) return fail();
  return { schema: "raceson-final-results-canary-status-v3", chainId: 10143, manifestHash: FINAL_RESULTS_CANARY_MANIFEST,
    observedBlock, wallets, deployment: "verified", contract };
}
