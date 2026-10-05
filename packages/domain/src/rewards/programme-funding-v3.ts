import { decodeSavedRewardPlanningDraft, previewRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "./programme-draft-v2.js";

export type ProgrammeFundingPotV3 = { slot: number; capWei: string; address: string; routed: boolean; state: 0 | 1 | 2 | 3 | 4 | 5;
  paused: boolean; accountedFundingWei: string; allocatedWei: string; paidWei: string; treasuryReturnedWei: string;
  returnedToProgrammeWei: string; balanceWei: string; remainingWei: string };
export type ProgrammeFundingObservationV3 = {
  address: string; funderAddress: string; operatorAddress: string; deploymentTransactionHash: string;
  deploymentBlockNumber: string; deploymentBlockHash: string; blockNumber: string; blockHash: string; blockTimestamp: string;
  depositedWei: string; totalRoutedWei: string; unroutedRefundedWei: string; returnedWei: string; returnsWithdrawnWei: string;
  pendingFundingWei: string; pendingReturnsWei: string; balanceWei: string; surplusWei: string; fundingAborted: boolean;
  pots: ProgrammeFundingPotV3[];
};
export type ProgrammeFundingViewV3 = {
  schema: "raceson-programme-funding-v3"; draftId: string; rulesRevision: number; chainId: 31337 | 10143;
  budgetWei: string; status: "awaiting_deployment" | "verified"; observation: ProgrammeFundingObservationV3 | null;
  operationsEnabled: false;
};
function check(ok: unknown): asserts ok { if (!ok) throw new Error("invalid_programme_funding_view"); }
function record(v: unknown, keys: string) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const r = v as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === keys.split(",").sort().join(",")); return r;
}
function amount(v: unknown): string { check(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 1n << 256n); return v; }
function address(v: unknown): string { check(typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && BigInt(v) !== 0n); return v; }
function hash(v: unknown): string { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v; }
export function emptyProgrammeFundingV3(input: SavedRewardPlanningDraft): ProgrammeFundingViewV3 {
  const d = decodeSavedRewardPlanningDraft(input);
  return { schema: "raceson-programme-funding-v3", draftId: d.draftId, rulesRevision: d.revision, chainId: d.chainId,
    budgetWei: previewRewardProgrammeDraftV2(d.rules).budgetWei.toString(), status: "awaiting_deployment", observation: null, operationsEnabled: false };
}
/** Explicit minimal browser DTO. No source registry, RPC URL, approvals, signatures
 * or private beneficiary association. Missing observation is not a zero balance. */
export function decodeProgrammeFundingV3(value: unknown, input: SavedRewardPlanningDraft): ProgrammeFundingViewV3 {
  const expected = emptyProgrammeFundingV3(input);
  const r = record(value, "schema,draftId,rulesRevision,chainId,budgetWei,status,observation,operationsEnabled");
  for (const key of ["schema", "draftId", "rulesRevision", "chainId", "budgetWei", "operationsEnabled"] as const) check(r[key] === expected[key]);
  if (r.status === "awaiting_deployment") { check(r.observation === null); return expected; }
  check(r.status === "verified");
  const o = record(r.observation, "address,funderAddress,operatorAddress,deploymentTransactionHash,deploymentBlockNumber,deploymentBlockHash,blockNumber,blockHash,blockTimestamp,depositedWei,totalRoutedWei,unroutedRefundedWei,returnedWei,returnsWithdrawnWei,pendingFundingWei,pendingReturnsWei,balanceWei,surplusWei,fundingAborted,pots");
  for (const key of ["address", "funderAddress", "operatorAddress"]) address(o[key]);
  check(new Set([o.address, o.funderAddress, o.operatorAddress].map(v => String(v).toLowerCase())).size === 3);
  for (const key of ["deploymentTransactionHash", "deploymentBlockHash", "blockHash"]) hash(o[key]);
  for (const key of ["deploymentBlockNumber", "blockNumber", "blockTimestamp", "depositedWei", "totalRoutedWei", "unroutedRefundedWei", "returnedWei", "returnsWithdrawnWei", "pendingFundingWei", "pendingReturnsWei", "balanceWei", "surplusWei"]) amount(o[key]);
  check(typeof o.fundingAborted === "boolean" && Array.isArray(o.pots) && o.pots.length === 6);
  const n = (key: string) => BigInt(o[key] as string), budget = BigInt(expected.budgetWei);
  check(n("blockTimestamp") > 0n && n("deploymentBlockNumber") <= n("blockNumber") && n("depositedWei") <= budget
    && n("depositedWei") === n("totalRoutedWei") + n("unroutedRefundedWei") + n("pendingFundingWei")
    && n("returnedWei") === n("returnsWithdrawnWei") + n("pendingReturnsWei")
    && n("balanceWei") === n("pendingFundingWei") + n("pendingReturnsWei") + n("surplusWei")
    && (o.fundingAborted || n("unroutedRefundedWei") === 0n));
  const addresses = new Set<string>([String(o.address).toLowerCase()]);
  const pots = o.pots.map((v, slot) => {
    const p = record(v, "slot,capWei,address,routed,state,paused,accountedFundingWei,allocatedWei,paidWei,treasuryReturnedWei,returnedToProgrammeWei,balanceWei,remainingWei");
    check(p.slot === slot && typeof p.routed === "boolean" && typeof p.paused === "boolean" && Number.isInteger(p.state)
      && (p.state as number) >= 0 && (p.state as number) <= 5 && (!p.paused || p.state === 3));
    const a = address(p.address).toLowerCase(); check(!addresses.has(a)); addresses.add(a);
    for (const key of ["capWei", "accountedFundingWei", "allocatedWei", "paidWei", "treasuryReturnedWei", "returnedToProgrammeWei", "balanceWei", "remainingWei"]) amount(p[key]);
    const b = (key: string) => BigInt(p[key] as string), cap = slot === 5 ? budget / 2n : budget / 10n;
    check(b("capWei") === cap && b("accountedFundingWei") === (p.routed ? cap : 0n)
      && b("paidWei") <= b("allocatedWei") && b("allocatedWei") <= b("accountedFundingWei")
      && b("remainingWei") + b("paidWei") + b("treasuryReturnedWei") === b("accountedFundingWei")
      && b("balanceWei") >= b("remainingWei") && b("returnedToProgrammeWei") >= b("treasuryReturnedWei")
      && (b("returnedToProgrammeWei") === 0n || p.state === 4 || p.state === 5));
    return { ...p } as ProgrammeFundingPotV3;
  });
  check(pots.reduce((sum, p) => sum + (p.routed ? BigInt(p.capWei) : 0n), 0n) === n("totalRoutedWei")
    && pots.reduce((sum, p) => sum + BigInt(p.returnedToProgrammeWei), 0n) === n("returnedWei"));
  return { ...expected, status: "verified", observation: { ...o, pots } as ProgrammeFundingObservationV3 };
}
