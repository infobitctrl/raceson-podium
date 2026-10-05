import { requireReward, parseRewardUnits } from "./arithmetic.js";

export type ProgrammeDepositQuoteV3 = {
  schema: "raceson-programme-deposit-v3"; chainId: 31337; draftId: string; rulesRevision: number;
  address: string; funderAddress: string; approvalId: string; contextHash: string; policyHash: string;
  expectedDepositedWei: string; amountWei: string; budgetWei: string; expiresAt: string;
};
export type ProgrammeDepositReviewV3 = { status: "ready"; quote: ProgrammeDepositQuoteV3 }
  | { status: "blocked"; reason: "deployment_required" | "fully_funded" | "funding_stopped" | "policy_required" | "testnet_execution_not_approved" };
const code = "invalid_programme_deposit";
export function programmeDepositAmountV3(value: unknown) {
  requireReward(typeof value === "string" && /^(0|[1-9]\d{0,30})(\.\d{1,18})?$/.test(value), code);
  const amount = parseRewardUnits(value, 18); requireReward(amount > 0n, code); return amount;
}
export function decodeProgrammeDepositQuoteV3(value: unknown): ProgrammeDepositQuoteV3 {
  requireReward(value && typeof value === "object" && !Array.isArray(value), code);
  const v = value as Record<string, unknown>;
  const keys = ["schema", "chainId", "draftId", "rulesRevision", "address", "funderAddress", "approvalId", "contextHash", "policyHash", "expectedDepositedWei", "amountWei", "budgetWei", "expiresAt"];
  requireReward(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), code);
  // Public execution is a separate unfulfilled release gate. This first wallet
  // request version can authorize local simulation ONLY; never infer a gate
  // from a browser switch, verified deployment, balance or arbitrary env flag.
  requireReward(v.schema === "raceson-programme-deposit-v3" && v.chainId === 31337 && Number.isSafeInteger(v.rulesRevision) && Number(v.rulesRevision) > 0, code);
  for (const k of ["draftId", "approvalId"]) requireReward(typeof v[k] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v[k]) && /[1-9a-f]/.test(v[k]), code);
  for (const k of ["address", "funderAddress"]) requireReward(typeof v[k] === "string" && /^0x[0-9a-f]{40}$/.test(v[k]) && BigInt(v[k]) > 0n, code);
  requireReward(typeof v.contextHash === "string" && /^[0-9a-f]{64}$/.test(v.contextHash)
    && typeof v.policyHash === "string" && /^0x[0-9a-f]{64}$/.test(v.policyHash), code);
  for (const k of ["expectedDepositedWei", "amountWei", "budgetWei"]) requireReward(typeof v[k] === "string" && /^(0|[1-9]\d{0,77})$/.test(v[k]) && BigInt(v[k]) < (1n << 256n), code);
  requireReward(BigInt(v.amountWei as string) > 0n && BigInt(v.expectedDepositedWei as string) + BigInt(v.amountWei as string) <= BigInt(v.budgetWei as string), code);
  requireReward(typeof v.expiresAt === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(v.expiresAt) && Number.isFinite(Date.parse(v.expiresAt)), code);
  return { ...v } as ProgrammeDepositQuoteV3;
}
export function sameProgrammeDepositV3(a: ProgrammeDepositQuoteV3, b: ProgrammeDepositQuoteV3) {
  const { expiresAt: _a, ...left } = decodeProgrammeDepositQuoteV3(a), { expiresAt: _b, ...right } = decodeProgrammeDepositQuoteV3(b);
  return Object.keys(left).every(key => left[key as keyof typeof left] === right[key as keyof typeof right]);
}
export function decodeProgrammeDepositReviewV3(value: unknown): ProgrammeDepositReviewV3 {
  requireReward(value && typeof value === "object" && !Array.isArray(value), code);
  const v = value as Record<string, unknown>; requireReward(Object.keys(v).length === 2, code);
  if (v.status === "ready") return { status: "ready", quote: decodeProgrammeDepositQuoteV3(v.quote) };
  requireReward(v.status === "blocked" && typeof v.reason === "string" && ["deployment_required", "fully_funded", "funding_stopped", "policy_required", "testnet_execution_not_approved"].includes(v.reason), code);
  return { status: "blocked", reason: v.reason as Extract<ProgrammeDepositReviewV3, { status: "blocked" }>["reason"] };
}
