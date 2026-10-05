import { z } from "zod";
import { readProgrammeLifecycleV3, readClaimV3, readClubClaimV3, type RewardAccountIdentity } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { workflowTargetV3, type WorkflowRuntimeOptionsV3, type WorkflowTargetV3 } from "./workflow-v3-service.js";
import { inspectProgrammeSigningV3 } from "./programme-signing-v3.js";
import { inspectPaymentSigningV3 } from "./athlete-payment-signing-v3.js";
import { inspectClubPaymentSigningV3 } from "./club-payment-signing-v3.js";

const uuid = z.string().uuid().regex(/^[0-9a-f-]+$/).refine(v => BigInt(`0x${v.replaceAll("-", "")}`) !== 0n);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(v => BigInt(v) !== 0n);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(v => BigInt(v) < 1n << 256n);
const permit = z.object({ target: workflowTargetV3, signPlanHash: hash.nullable(), approvalPlanHash: hash.nullable(),
  transactionHash: hash.nullable(), maxGasCostWei: uint, maxRewardWei: uint }).strict();
const policySchema = z.object({ schema: z.literal("raceson-workflow-host-policy-v1"), operatorUserId: uuid, draftId: uuid,
  durationSeconds: z.number().int().min(1).max(1800), maxGasCostWei: uint, maxRewardWei: uint,
  permits: z.array(permit).max(100) }).strict();
export function parseWorkflowHostPolicyV3(input: unknown) {
  const p = policySchema.parse(input);
  requireReward(new Set(p.permits.map(v => v.target.attemptId)).size === p.permits.length, "reward_workflow_authority_required");
  requireReward(p.permits.reduce((sum, v) => sum + BigInt(v.maxGasCostWei), 0n) <= BigInt(p.maxGasCostWei)
    && p.permits.reduce((sum, v) => sum + BigInt(v.maxRewardWei), 0n) <= BigInt(p.maxRewardWei), "reward_workflow_authority_required");
  for (const v of p.permits) {
    requireReward(v.signPlanHash || v.approvalPlanHash || v.transactionHash, "reward_workflow_authority_required");
    if (v.target.kind === "programme") requireReward(v.target.draftId === p.draftId && !v.approvalPlanHash
      && v.maxRewardWei === "0", "reward_workflow_authority_required");
    if (v.signPlanHash || v.transactionHash) requireReward(BigInt(v.maxGasCostWei) > 0n, "reward_workflow_authority_required");
  }
  return p;
}
type Policy = ReturnType<typeof parseWorkflowHostPolicyV3>;
type Operation = Parameters<WorkflowRuntimeOptionsV3["authorize"]>[1];
export function workflowPermissionV3(p: Policy, actor: RewardAccountIdentity, operation: Operation, target: WorkflowTargetV3, binding: string | null) {
  requireReward(actor.userId === p.operatorUserId, "reward_workflow_authority_required");
  if (target.kind === "programme") requireReward(target.draftId === p.draftId, "reward_workflow_authority_required");
  if (["inspect", "inspect-approval", "status"].includes(operation)) return null;
  const selected = p.permits.find(v => canonicalRewardJson(v.target) === canonicalRewardJson(target));
  const expected = operation === "sign" ? selected?.signPlanHash : operation === "approve" ? selected?.approvalPlanHash : selected?.transactionHash;
  requireReward(selected && expected && expected === binding, "reward_workflow_authority_required"); return selected;
}

/** Private, bounded token cache. No refresh, login, session minting, disk or
 * logging. Every admission/reuse verifies the JWT through the supplied SDK
 * verifier; SQL methods still verify current auth.sessions and organizer scope. */
export function createWorkflowSessionVaultV3(verifyToken: (token: string) => Promise<{ identity: RewardAccountIdentity; expiresAtMs: number }>, signal: AbortSignal) {
  const entries = new Map<string, { token: string; expiresAtMs: number }>();
  const key = (a: RewardAccountIdentity) => `${uuid.parse(a.userId)}:${uuid.parse(a.sessionId)}`;
  const active = () => requireReward(!signal.aborted, "reward_account_session_required");
  signal.addEventListener("abort", () => entries.clear(), { once: true });
  return {
    async admit(actor: RewardAccountIdentity, token: string) {
      active(); requireReward(typeof token === "string" && token.length > 0 && token.length <= 8192, "reward_account_session_required");
      const verified = await verifyToken(token); active();
      requireReward(key(verified.identity) === key(actor) && Number.isSafeInteger(verified.expiresAtMs)
        && verified.expiresAtMs > Date.now() + 5000, "reward_account_session_required");
      for (const [k, v] of entries) if (v.expiresAtMs <= Date.now()) entries.delete(k);
      requireReward(entries.has(key(actor)) || entries.size < 100, "reward_account_session_required");
      const saved = entries.get(key(actor));
      // Concurrent requests carrying the same verified token do not revoke an
      // in-flight grant; a different token still replaces and fences it.
      if (saved?.token !== token || saved.expiresAtMs !== verified.expiresAtMs)
        entries.set(key(actor), { token, expiresAtMs: verified.expiresAtMs });
    },
    async verify(actor: RewardAccountIdentity) {
      active(); const k = key(actor), saved = entries.get(k);
      requireReward(saved && saved.expiresAtMs > Date.now() + 5000, "reward_account_session_required");
      const verified = await verifyToken(saved.token); active();
      requireReward(entries.get(k) === saved && key(verified.identity) === k && verified.expiresAtMs === saved.expiresAtMs
        && saved.expiresAtMs > Date.now() + 5000, "reward_account_session_required");
      return { expiresAtMs: Math.min(saved.expiresAtMs - 5000, Date.now() + 1_800_000), assertActive: () => {
        active(); requireReward(entries.get(k) === saved && saved.expiresAtMs > Date.now() + 5000, "reward_account_session_required");
      } };
    },
    clear: () => entries.clear(),
  };
}

/** Concrete scope/spending authority. It cannot create readiness/consent or
 * infer approvals from a browser plan. Exact permitted hashes must have been
 * reviewed in the private startup policy before keys are available. */
export function createWorkflowPolicyAuthorityV3(options: Pick<WorkflowRuntimeOptionsV3, "target" | "rpc" | "reader"> & {
  policy: unknown; assertSource: () => void; sessions: ReturnType<typeof createWorkflowSessionVaultV3>;
}): WorkflowRuntimeOptionsV3["authorize"] {
  const p = parseWorkflowHostPolicyV3(options.policy), { rpc, reader, assertSource, sessions } = options;
  const target = rewardDemoTarget(options.target) as RewardDemoTarget | null;
  requireReward(target && target.chainId === options.target.chainId, "reward_workflow_not_configured");
  const deps = { rpc, reader, chainId: target.chainId, origin: target.origin };
  return async (actor, operation, t, binding) => {
    assertSource(); const permit = workflowPermissionV3(p, actor, operation, t, binding);
    const session = await sessions.verify(actor); assertSource();
    let amount = 0n;
    if (t.kind === "programme") {
      await readProgrammeLifecycleV3(actor, { ...t, chainId: target.chainId }, rpc);
    } else {
      const c = t.kind === "athlete" ? await readClaimV3(actor, { ...t, chainId: target.chainId, role: "operator" }, rpc)
        : await readClubClaimV3(actor, { ...t, requestId: t.treasuryId, chainId: target.chainId, role: "operator" }, rpc);
      requireReward(c.readiness.source.draftId === p.draftId && c.readiness.source.operatorUserId === p.operatorUserId,
        "reward_workflow_authority_required");
      if (permit) { requireReward(c.intent, "reward_claim_scope_required"); amount = c.intent.witness.amountWei; }
    }
    if (permit) {
      requireReward(amount <= BigInt(permit.maxRewardWei), "reward_workflow_authority_required");
      if (operation !== "approve") {
        const scoped = { ...t, chainId: target.chainId };
        const view = t.kind === "programme" ? await inspectProgrammeSigningV3(actor, { ...t, chainId: target.chainId }, deps)
          : t.kind === "athlete" ? await inspectPaymentSigningV3(actor, { ...t, chainId: target.chainId }, deps)
            : await inspectClubPaymentSigningV3(actor, { ...scoped, requestId: t.treasuryId } as Parameters<typeof inspectClubPaymentSigningV3>[1], deps);
        const fees = "fees" in view.plan ? view.plan.fees : view.plan;
        requireReward(BigInt(fees.gasLimit) * BigInt(fees.maxFeePerGas) <= BigInt(permit.maxGasCostWei), "reward_workflow_authority_required");
        requireReward(operation === "sign" ? view.plan.planHash === binding : view.recorded && view.transactionHash === binding,
          "reward_workflow_authority_required");
      }
    }
    assertSource(); session.assertActive();
    return { expiresAtMs: session.expiresAtMs, assertActive: () => { assertSource(); session.assertActive(); } };
  };
}
