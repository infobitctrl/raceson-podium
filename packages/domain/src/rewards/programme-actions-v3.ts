import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";
import { decodeProgrammeExecutionStatusV3, programmeExecutionProgressV3, type ProgrammeExecutionStatusV3 } from "./programme-execution-status-v3.js";
import { decodeRoundPublicationV3, type RoundPublicationViewV3 } from "./round-publication-v3.js";

function check(v: unknown): asserts v { if (!v) throw Error("invalid_reward_programme_action"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
function uint(v: unknown) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n); return v; }
function digest(v: unknown) { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; }
function hash(v: unknown) { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v; }
export function decodeProgrammeActionFeesV3(value: unknown) {
  const r = object(value, ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "maxGasCostWei"]);
  const gasLimit = uint(r.gasLimit), maxFeePerGas = uint(r.maxFeePerGas), maxPriorityFeePerGas = uint(r.maxPriorityFeePerGas), maxGasCostWei = uint(r.maxGasCostWei);
  check(BigInt(gasLimit) > 0n && BigInt(gasLimit) <= 30000000n && BigInt(maxFeePerGas) > 0n
    && BigInt(maxPriorityFeePerGas) <= BigInt(maxFeePerGas) && BigInt(gasLimit) * BigInt(maxFeePerGas) <= BigInt(maxGasCostWei));
  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxGasCostWei };
}
export function decodeProgrammeActionRequestV3(value: unknown) {
  // Inspect the discriminator without invoking accessors.
  check(value && typeof value === "object");
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "prepare") {
    const r = object(value, ["kind", "requestId", "expectedPredecessorId", "packageHash", "fees"]);
    return { kind: "prepare" as const, requestId: uuid(r.requestId), expectedPredecessorId: r.expectedPredecessorId === null ? null : uuid(r.expectedPredecessorId),
      packageHash: digest(r.packageHash), fees: decodeProgrammeActionFeesV3(r.fees) };
  }
  check(kind === "queue");
  const r = object(value, ["kind", "requestId", "intentId", "attemptId", "transactionHash", "packageHash"]);
  return { kind: "queue" as const, requestId: uuid(r.requestId), intentId: uuid(r.intentId), attemptId: uuid(r.attemptId),
    transactionHash: hash(r.transactionHash), packageHash: digest(r.packageHash) };
}
export type ProgrammeActionRequestV3 = ReturnType<typeof decodeProgrammeActionRequestV3>;

/** A saved final decision is required for staging and activation. These actions
 * never publish results themselves or consent/pay on behalf of a recipient. */
export function nextProgrammeActionV3(execution: ProgrammeExecutionStatusV3, publication?: RoundPublicationViewV3 | null) {
  const published = Boolean(publication?.supported && publication.current && publication.publication && publication.review
    && ["chainId", "draftId", "slot", "approvalId", "uploadId", "packageHash"].every(k =>
      publication[k as keyof RoundPublicationViewV3] === execution[k as keyof ProgrammeExecutionStatusV3]));
  return nextProgrammeExecutionActionV3(execution, published);
}

/** Source adapters supply publication readiness only after their own exact
 * scope/source checks. This helper grants no signing or execution authority. */
export function nextProgrammeExecutionActionV3(execution: ProgrammeExecutionStatusV3, published: boolean) {
  const last = execution.steps.at(-1);
  if (!execution.current || (last && last.state !== "confirmed")) return null;
  if (!last) return { action: "complete_funding" as const, predecessorId: null, batchStart: null, batchSize: null };
  const progress = programmeExecutionProgressV3(execution);
  if (!progress.fundingClosed) return null;
  if (progress.uploadComplete) {
    if (!published) return null;
    if (last.action === "activate") return null;
    return { action: last.action === "stage_allocation" ? "activate" as const : "stage_allocation" as const,
      predecessorId: last.intentId, batchStart: null, batchSize: null };
  }
  return { action: "upload_awards" as const, predecessorId: last.intentId, batchStart: progress.uploaded,
    batchSize: Math.min(64, Number(execution.entitlementCount) - progress.uploaded) };
}

/** Whitelisted organizer projection. Never add signed bytes, salts, identities
 * or lease capabilities from the private lifecycle repositories. */
export function decodeProgrammeActionsV3(value: unknown) {
  const r = object(value, ["schema", "execution", "selected", "ack", "publication"]);
  check(r.schema === "raceson-programme-actions-v3");
  const execution = decodeProgrammeExecutionStatusV3(r.execution), last = execution.steps.at(-1);
  const { chainId, draftId, slot, approvalId, uploadId, packageHash } = execution;
  const publication = r.publication === null ? null : { schema: "raceson-round-publication-view-v3" as const,
    ...decodeRoundPublicationV3(r.publication, { chainId, draftId, slot, approvalId, uploadId, packageHash }) };
  const { selected, ack } = decodeProgrammeActionStateV3(execution, r.selected, r.ack);
  return { schema: "raceson-programme-actions-v3" as const, execution, selected, ack, publication };
}

export function decodeProgrammeActionStateV3(execution: ProgrammeExecutionStatusV3, selectedValue: unknown, ackValue: unknown) {
  const last = execution.steps.at(-1);
  let selected = null;
  if (selectedValue !== null) {
    const s = object(selectedValue, ["intentId", "operatorAddress", "nonce", "fees", "attemptId", "jobId"]);
    check(last && s.intentId === last.intentId && typeof s.operatorAddress === "string"
      && /^0x[0-9a-f]{40}$/.test(s.operatorAddress) && BigInt(s.operatorAddress) !== 0n);
    const nonce = uint(s.nonce); check(BigInt(nonce) <= BigInt(Number.MAX_SAFE_INTEGER));
    const attemptId = s.attemptId === null ? null : uuid(s.attemptId), jobId = s.jobId === null ? null : uuid(s.jobId);
    check((last.state === "reserved") === (attemptId === null) && (["reserved", "signed"].includes(last.state)) === (jobId === null));
    selected = { intentId: last.intentId, operatorAddress: s.operatorAddress, nonce, fees: decodeProgrammeActionFeesV3(s.fees), attemptId, jobId };
  }
  check(Boolean(last) === Boolean(selected));
  let ack = null;
  if (ackValue !== null) { const a = object(ackValue, ["kind", "requestId"]); check(a.kind === "prepare" || a.kind === "queue");
    ack = { kind: a.kind as "prepare" | "queue", requestId: uuid(a.requestId) }; }
  return { selected, ack };
}
export type ProgrammeActionsV3 = ReturnType<typeof decodeProgrammeActionsV3>;
