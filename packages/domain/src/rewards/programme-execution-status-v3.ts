import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_programme_execution_status"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function uint(v: unknown) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n); return v; }
function digest(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
function hash(v: unknown) { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v; }
function integer(v: unknown, max: number) { check(Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max); return v as number; }
const states = ["reserved", "signed", "queued", "leased", "broadcasting", "submitted", "confirmed"] as const;

/** Read-only recorded history. No current-chain balance, payout eligibility,
 * execution authority, private signature, source identity or lease capability. */
export function decodeProgrammeExecutionStatusV3(value: unknown) {
  const r = object(value, ["schema", "chainId", "draftId", "slot", "approvalId", "uploadId", "packageHash", "documentHash",
    "current", "campaignAddress", "entitlementCount", "steps"]);
  check(r.schema === "raceson-programme-execution-status-v3" && (r.chainId === 31337 || r.chainId === 10143));
  const slot = integer(r.slot, 6); check(slot > 0 && typeof r.current === "boolean");
  check(typeof r.campaignAddress === "string" && /^0x[0-9a-f]{40}$/.test(r.campaignAddress) && BigInt(r.campaignAddress) !== 0n);
  const entitlementCount = uint(r.entitlementCount); check(BigInt(entitlementCount) <= 10000n);
  check(Array.isArray(r.steps) && r.steps.length <= Number(entitlementCount) + 3);
  const descriptors = Object.getOwnPropertyDescriptors(r.steps); check(Reflect.ownKeys(r.steps).length === r.steps.length + 1);
  let planned = 0, predecessorConfirmed = true, previousBlock = 0n, staged = false, activated = false;
  const ids = new Set<string>(), hashes = new Set<string>();
  const steps = Array.from({ length: r.steps.length }, (_, index) => {
    const field = descriptors[String(index)]; check(field?.enumerable && "value" in field);
    const s = object(field.value, ["intentId", "step", "action", "batchStart", "batchSize", "state", "transactionHash", "receipt"]);
    const intentId = uuid(s.intentId), step = integer(s.step, 10000); check(step === index && !ids.has(intentId)); ids.add(intentId);
    check(states.includes(s.state as typeof states[number])); const state = s.state as typeof states[number];
    let batchStart = null, batchSize = null;
    if (index === 0) check(s.action === "complete_funding" && s.batchStart === null && s.batchSize === null);
    else if (s.action === "upload_awards") {
      check(!staged && !activated);
      batchStart = integer(s.batchStart, 9999); batchSize = integer(s.batchSize, 64);
      check(s.action === "upload_awards" && batchStart === planned && batchSize > 0);
      planned += batchSize; check(planned <= Number(entitlementCount));
    } else {
      check(planned === Number(entitlementCount) && predecessorConfirmed && s.batchStart === null && s.batchSize === null && !activated);
      if (s.action === "stage_allocation") { check(!staged); staged = true; }
      else { check(s.action === "activate" && staged); activated = true; }
    }
    const transactionHash = s.transactionHash === null ? null : hash(s.transactionHash);
    check((state === "reserved") === (transactionHash === null));
    if (transactionHash) { check(!hashes.has(transactionHash)); hashes.add(transactionHash); }
    let receipt = null;
    if (s.receipt !== null) {
      const c = object(s.receipt, ["blockNumber", "blockHash", "blockTimestamp", "feeWei", "recordedAt"]);
      const blockNumber = uint(c.blockNumber), blockTimestamp = uint(c.blockTimestamp), feeWei = uint(c.feeWei);
      check(state === "confirmed" && predecessorConfirmed && BigInt(blockNumber) > 0n && BigInt(blockNumber) >= previousBlock
        && BigInt(blockTimestamp) > 0n && BigInt(feeWei) > 0n && typeof c.recordedAt === "string" && Number.isFinite(Date.parse(c.recordedAt)));
      previousBlock = BigInt(blockNumber);
      receipt = { blockNumber, blockHash: hash(c.blockHash), blockTimestamp, feeWei, recordedAt: c.recordedAt as string };
    }
    check((state === "confirmed") === (receipt !== null)); predecessorConfirmed = state === "confirmed";
    return { intentId, step, action: s.action as "complete_funding" | "upload_awards" | "stage_allocation" | "activate", batchStart, batchSize, state, transactionHash, receipt };
  });
  return { schema: "raceson-programme-execution-status-v3" as const, chainId: r.chainId, draftId: uuid(r.draftId), slot,
    approvalId: uuid(r.approvalId), uploadId: uuid(r.uploadId), packageHash: digest(r.packageHash), documentHash: digest(r.documentHash),
    current: r.current, campaignAddress: r.campaignAddress, entitlementCount, steps };
}
export function programmeActivationProgressV3(view: ProgrammeExecutionStatusV3) {
  return { staged: view.steps.some(s => s.action === "stage_allocation" && s.state === "confirmed"),
    activated: view.steps.some(s => s.action === "activate" && s.state === "confirmed") };
}
export type ProgrammeExecutionStatusV3 = ReturnType<typeof decodeProgrammeExecutionStatusV3>;
export function programmeExecutionProgressV3(view: ProgrammeExecutionStatusV3) {
  const fundingClosed = view.steps[0]?.state === "confirmed";
  const uploaded = view.steps.reduce((sum, step) => sum + (step.state === "confirmed" ? step.batchSize ?? 0 : 0), 0);
  return { fundingClosed, uploaded, uploadComplete: fundingClosed && uploaded === Number(view.entitlementCount) };
}
