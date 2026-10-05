import { z } from "zod";
import { keccak256, toHex, type Hex } from "viem";
import { readProgrammeLifecycleJobV3, paymentLedgerV3, clubPaymentLedgerV3,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { reviewAthleteClaimSigningV3, recordAthleteClaimProofV3 } from "./athlete-claims-v3-service.js";
import { reviewClubClaimSigningV3, recordClubClaimProofV3 } from "./club-claims-v3-service.js";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { inspectProgrammeSigningV3, signProgrammeV3, type ProgrammeSignerV3 } from "./programme-signing-v3.js";
import { inspectPaymentSigningV3, signPaymentV3 } from "./athlete-payment-signing-v3.js";
import { inspectClubPaymentSigningV3, signClubPaymentV3 } from "./club-payment-signing-v3.js";
import { runProgrammeLifecycleJobV3 } from "./programme-lifecycle-worker-v3.js";
import { runPaymentJobV3 } from "./athlete-payment-worker-v3.js";
import { runClubPaymentJobV3 } from "./club-payment-worker-v3.js";
import type { ClubPaymentDependenciesV3 } from "./club-payment-v3-service.js";
import type { WorkflowScheduleV3 } from "./workflow-v3-scheduler.js";

const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/).refine(v => BigInt(`0x${v.replaceAll("-", "")}`) !== 0n);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(v => BigInt(v) !== 0n);
const common = { uploadId: uuid, entitlementId: hash, claimId: uuid, paymentId: uuid, attemptId: uuid };
export const workflowTargetV3 = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("programme"), draftId: uuid, slot: z.number().int().min(1).max(6), approvalId: uuid,
    uploadId: uuid, intentId: uuid, attemptId: uuid }).strict(),
  z.object({ kind: z.literal("athlete"), ...common, destinationId: uuid }).strict(),
  z.object({ kind: z.literal("club"), ...common, treasuryId: uuid }).strict(),
]);
export type WorkflowTargetV3 = z.infer<typeof workflowTargetV3>;
export const workflowInspectV3 = z.object({ target: workflowTargetV3 }).strict();
export const workflowSignV3 = workflowInspectV3.extend({ planHash: hash }).strict();
export const workflowJobV3 = workflowInspectV3.extend({ jobId: uuid, transactionHash: hash }).strict();
export type WorkflowJobV3 = z.infer<typeof workflowJobV3>;
export type WorkflowTraceV3 = (event: { operation: string; durationMs: number; outcome: "ok" | "error" }) => void;
export async function traceWorkflowV3<T>(trace: WorkflowTraceV3 | undefined, operation: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now(); let outcome: "ok" | "error" = "error";
  try { const value = await run(); outcome = "ok"; return value; }
  finally { try { trace?.({ operation, durationMs: Math.round(performance.now() - start), outcome }); } catch { /* Telemetry cannot change an action. */ } }
}
/** Host-only capability. The host must freshly validate its exact source/target,
 * bounded spending approval and live operator session, returning an expiring
 * synchronous fence. No default credential loader or public-chain authority. */
export type WorkflowAuthorityV3 = {
  expiresAtMs: number;
  assertActive: () => void;
};
export type WorkflowRuntimeOptionsV3 = {
  target: RewardDemoTarget;
  rpc: RewardLedgerRpc;
  reader: ClubPaymentDependenciesV3["reader"];
  authorize: (actor: RewardAccountIdentity, operation: "inspect" | "sign" | "schedule" | "status" | "deliver" | "inspect-approval" | "approve",
    target: WorkflowTargetV3, binding: string | null) => Promise<WorkflowAuthorityV3>;
  loadSigner: (role: "operator" | "relayer") => Promise<ProgrammeSignerV3>;
  loadApprovalSigner: () => Promise<{ signTypedData: (message: Record<string, unknown>) => Promise<Hex> }>;
  broadcast: (bytes: Hex) => Promise<Hex>;
  trace?: WorkflowTraceV3;
};
export function createWorkflowRuntimeV3(options: WorkflowRuntimeOptionsV3) {
  const target = rewardDemoTarget(options.target);
  requireReward(target && target.chainId === options.target.chainId, "reward_workflow_not_configured");
  const { rpc, reader, authorize, loadSigner, loadApprovalSigner, broadcast, trace } = options;
  const chainId = target.chainId, origin = target.origin;
  const deps = { chainId, origin, rpc, reader };
  const actorCopy = (a: RewardAccountIdentity) => ({ userId: uuid.parse(a.userId), sessionId: uuid.parse(a.sessionId) });
  const scoped = <T extends WorkflowTargetV3>(t: T) => ({ ...t, chainId, requestId: t.kind === "club" ? t.treasuryId : "" });
  async function authority(actor: RewardAccountIdentity, operation: Parameters<typeof authorize>[1], t: WorkflowTargetV3, binding: string | null) {
    const grant = await authorize(actor, operation, t, binding);
    // Every capability is bounded, even if a host accidentally returns Infinity.
    requireReward(Number.isSafeInteger(grant.expiresAtMs) && grant.expiresAtMs <= Date.now() + 1800000, "reward_workflow_authority_required");
    const active = () => { requireReward(Date.now() < grant.expiresAtMs, "reward_account_session_required"); grant.assertActive(); };
    active(); return { active, expiresAtMs: grant.expiresAtMs };
  }
  async function inspectStored(actor: RewardAccountIdentity, t: WorkflowTargetV3) {
    if (t.kind === "programme") return inspectProgrammeSigningV3(actor, scoped(t), deps);
    if (t.kind === "athlete") return inspectPaymentSigningV3(actor, scoped(t), deps);
    return inspectClubPaymentSigningV3(actor, scoped(t), deps);
  }
  const project = (t: WorkflowTargetV3, view: Awaited<ReturnType<typeof inspectStored>>) => ({
    schema: "raceson-workflow-inspection-v1" as const, target: t, ...view,
  });
  async function readJob(actor: RewardAccountIdentity, request: WorkflowJobV3) {
    const t = request.target;
    const job = t.kind === "programme" ? (await readProgrammeLifecycleJobV3(actor, scoped(t), rpc)).job
      : t.kind === "athlete" ? (await paymentLedgerV3(actor, scoped(t), undefined, rpc))?.job
        : (await clubPaymentLedgerV3(actor, scoped(t), undefined, rpc))?.job;
    requireReward(job && job.jobId === request.jobId && job.attemptId === t.attemptId && job.transactionHash === request.transactionHash,
      "reward_workflow_job_conflict");
    // Lease tokens and signed bytes are never part of this projection.
    return { state: job.state, confirmed: job.state === "confirmed", jobId: job.jobId, transactionHash: job.transactionHash, reconciliationRequired: job.mayHaveBroadcast };
  }
  async function reviewApproval(actor: RewardAccountIdentity, t: WorkflowTargetV3) {
    requireReward(t.kind !== "programme", "invalid_reward_workflow_request");
    return t.kind === "athlete" ? reviewAthleteClaimSigningV3(actor, { ...scoped(t), role: "operator" }, deps)
      : reviewClubClaimSigningV3(actor, { ...scoped(t), role: "operator" }, deps);
  }
  function approvalProjection(t: WorkflowTargetV3, view: Awaited<ReturnType<typeof reviewApproval>>) {
    const body = { target: t, chainId, claimId: view.claimId, recipientAddress: view.recipientAddress,
      amountWei: view.amountWei, issuedAt: view.issuedAt, expiresAt: view.expiresAt };
    // A recorded proof has no new signing offer. The exact claim is immutable.
    return { schema: "raceson-workflow-approval-v1" as const, target: t, recorded: view.status === "already_recorded",
      plan: view.status === "already_recorded" ? null : { ...body,
        planHash: keccak256(toHex(canonicalRewardJson({ ...body, typedData: view.typedData }))) } };
  }
  return {
    chainId, origin,
    inspectApproval: (identity: RewardAccountIdentity, input: unknown) => traceWorkflowV3(trace, "inspect_approval", async () => {
      const actor = actorCopy(identity), t = workflowInspectV3.parse(input).target;
      const grant = await authority(actor, "inspect-approval", t, null), view = await reviewApproval(actor, t);
      grant.active(); return approvalProjection(t, view);
    }),
    approve: (identity: RewardAccountIdentity, input: unknown) => traceWorkflowV3(trace, "approve", async () => {
      const actor = actorCopy(identity), request = workflowSignV3.parse(input), t = request.target;
      const grant = await authority(actor, "approve", t, request.planHash);
      const first = await reviewApproval(actor, t), initial = approvalProjection(t, first);
      if (initial.recorded) { grant.active(); return initial; }
      requireReward(initial.plan?.planHash === request.planHash, "reward_payment_signing_plan_changed");
      grant.active(); const key = await loadApprovalSigner(); grant.active();
      const fresh = await reviewApproval(actor, t), reviewed = approvalProjection(t, fresh);
      if (reviewed.recorded) { grant.active(); return reviewed; }
      requireReward(reviewed.plan?.planHash === request.planHash && fresh.status === "signature_required", "reward_payment_signing_plan_changed");
      requireReward(fresh.typedData && typeof fresh.typedData === "object" && !Array.isArray(fresh.typedData), "reward_payment_signing_plan_changed");
      grant.active(); const signature = await key.signTypedData(fresh.typedData as Record<string, unknown>); grant.active();
      // Existing proof verifier checks the actual operator signer and rechecks
      // wallet/source/session/chain after signing; no implicit readiness review.
      if (t.kind === "athlete") await recordAthleteClaimProofV3(actor, { ...scoped(t), role: "operator", signature }, deps);
      else if (t.kind === "club") await recordClubClaimProofV3(actor, { ...scoped(t), role: "operator", signature }, deps);
      else throw Error("invalid_reward_workflow_request");
      const final = await reviewApproval(actor, t); grant.active(); return approvalProjection(t, final);
    }),
    inspect: (identity: RewardAccountIdentity, input: unknown) => traceWorkflowV3(trace, "inspect", async () => {
      const actor = actorCopy(identity), t = workflowInspectV3.parse(input).target;
      const grant = await authority(actor, "inspect", t, null), view = await inspectStored(actor, t); grant.active();
      return project(t, view);
    }),
    sign: (identity: RewardAccountIdentity, input: unknown) => traceWorkflowV3(trace, "sign", async () => {
      const actor = actorCopy(identity), request = workflowSignV3.parse(input), t = request.target;
      const grant = await authority(actor, "sign", t, request.planHash);
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, grant.expiresAtMs - Date.now()));
      // The existing signing services re-read Auth/source/chain after key loading.
      // Wrap the signer so expiry/revocation also gates the actual signing call.
      const signer = async () => {
        grant.active(); const key = await loadSigner(t.kind === "programme" ? "operator" : "relayer"); grant.active();
        return { address: key.address, signTransaction: (tx: Parameters<ProgrammeSignerV3["signTransaction"]>[0]) => {
          grant.active(); return key.signTransaction(tx);
        } };
      };
      try {
        const input = { ...scoped(t), planHash: request.planHash as Hex }, d = { ...deps, loadSigner: signer, signal: controller.signal };
        if (t.kind === "programme") await signProgrammeV3(actor, { ...scoped(t), planHash: input.planHash }, d);
        else if (t.kind === "athlete") await signPaymentV3(actor, { ...scoped(t), planHash: input.planHash }, d);
        else await signClubPaymentV3(actor, { ...scoped(t), planHash: input.planHash }, d);
        const view = await inspectStored(actor, t); grant.active(); return project(t, view);
      } finally { clearTimeout(timer); controller.abort(); }
    }),
    job: (identity: RewardAccountIdentity, input: unknown, operation: "schedule" | "status" = "status") => traceWorkflowV3(trace, operation, async () => {
      const actor = actorCopy(identity), request = workflowJobV3.parse(input);
      const grant = await authority(actor, operation, request.target, request.transactionHash);
      const view = await readJob(actor, request); grant.active(); return view;
    }),
    deliver: (identity: RewardAccountIdentity, record: WorkflowScheduleV3, markSend: () => void) => traceWorkflowV3(trace, "deliver", async () => {
      const actor = actorCopy(identity), request = workflowJobV3.parse({ target: record.target, jobId: record.jobId, transactionHash: record.transactionHash }), t = request.target;
      requireReward(record.chainId === chainId && record.userId === actor.userId, "reward_workflow_job_conflict");
      const grant = await authority(actor, "deliver", t, request.transactionHash);
      const stored = await readJob(actor, request); grant.active();
      if (stored.confirmed) return { jobId: request.jobId, outcome: "confirmed" };
      const receiptOnly = stored.reconciliationRequired;
      const send = (bytes: Hex) => {
        grant.active();
        requireReward(!receiptOnly && keccak256(bytes) === request.transactionHash, "reward_workflow_reconciliation_required");
        markSend(); // fsync'd, cross-process exclusive marker BEFORE network handoff.
        grant.active(); return broadcast(bytes);
      };
      const selected = { ...scoped(t), jobId: request.jobId, workerId: record.workerId };
      if (t.kind === "programme") return runProgrammeLifecycleJobV3(actor, { ...scoped(t), jobId: selected.jobId, workerId: selected.workerId }, { ...deps, broadcast: send });
      if (t.kind === "athlete") return runPaymentJobV3(actor, { ...scoped(t), jobId: selected.jobId, workerId: selected.workerId }, { ...deps, broadcast: send });
      return runClubPaymentJobV3(actor, { ...scoped(t), jobId: selected.jobId, workerId: selected.workerId }, { ...deps, broadcast: send });
    }),
  };
}
export type WorkflowRuntimeV3 = ReturnType<typeof createWorkflowRuntimeV3>;
