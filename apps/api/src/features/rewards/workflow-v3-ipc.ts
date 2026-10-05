import { createServer, request as httpRequest } from "node:http";
import { chmodSync, lstatSync, realpathSync, existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { executeWorkflowRequestV3, workflowOperationV3, type WorkflowBridgeV3, type WorkflowHostV3 } from "./workflow-v3-request.js";

// Fresh, rate-paced testnet inspection may exceed 30s. Transport time is not
// authority: the independently bounded session/source grant still gates writes.
export const workflowIpcDeadlineMsV3 = 360_000;
const envelope = z.object({ actor: z.object({ userId: z.string().uuid(), sessionId: z.string().uuid() }).strict(),
  accessToken: z.string().min(1).max(8192), operation: workflowOperationV3, input: z.unknown() }).strict();
const codes = new Set(["reward_account_session_required", "reward_workflow_authority_required", "reward_workflow_not_configured",
  "reward_workflow_job_conflict", "reward_workflow_status_changed", "reward_programme_signing_plan_changed", "reward_payment_signing_plan_changed",
  "reward_allocation_not_ready", "reward_recipient_consent_required", "reward_claim_readiness_required", "reward_payment_approvals_required",
  "reward_claim_already_paid", "reward_payment_conflict", "reward_claim_window_unavailable", "reward_programme_lifecycle_attempt_conflict",
  "reward_claim_scope_required", "reward_readiness_scope_required", "reward_payment_scope_required", "reward_planning_not_found",
  "invalid_reward_workflow_request"]);
function safeCode(e: unknown) {
  if (e instanceof z.ZodError) return "invalid_reward_workflow_request";
  const c = e && typeof e === "object" && "code" in e ? String(e.code) : e instanceof Error ? e.message : "";
  return codes.has(c) ? c : "reward_workflow_unavailable";
}
/** One owner-only local IPC endpoint. No TCP fallback, symlinks, remote path,
 * request-chosen socket, automatic stale-socket removal or credential file. */
export function assertWorkflowSocketV3(path: string, requireSocket: boolean) {
  requireReward(isAbsolute(path) && resolve(path) === path && Buffer.byteLength(path) < 100, "reward_workflow_not_configured");
  const parent = dirname(path), stat = lstatSync(parent);
  requireReward(realpathSync(parent) === parent && stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
    && (process.getuid === undefined || stat.uid === process.getuid()), "reward_workflow_not_configured");
  if (requireSocket) {
    const socket = lstatSync(path);
    requireReward(socket.isSocket() && !socket.isSymbolicLink() && (socket.mode & 0o077) === 0
      && (process.getuid === undefined || socket.uid === process.getuid()), "reward_workflow_not_configured");
  } else requireReward(!existsSync(path), "reward_workflow_not_configured");
}

export function createWorkflowBridgeV3(options: { target: RewardDemoTarget; socketPath: string; accessToken: string }): WorkflowBridgeV3 {
  const target = rewardDemoTarget(options.target), { socketPath, accessToken } = options;
  requireReward(target && target.chainId === options.target.chainId && target.mode !== "testnet", "reward_workflow_not_configured");
  return { chainId: target.chainId, origin: target.origin, dispatch: async (actor, operation, input) => {
    assertWorkflowSocketV3(socketPath, true);
    const body = JSON.stringify(envelope.parse({ actor, accessToken, operation, input }));
    requireReward(Buffer.byteLength(body) <= 32768, "invalid_reward_workflow_request");
    return new Promise((resolve, reject) => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), workflowIpcDeadlineMsV3);
      const fail = () => { clearTimeout(timer); reject(Error("reward_workflow_unavailable")); };
      const req = httpRequest({ socketPath, path: "/workflow-v3", method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Connection": "close" } }, res => {
        let bytes = 0; const chunks: Buffer[] = [];
        res.on("error", fail); res.on("aborted", fail);
        res.on("data", chunk => { bytes += chunk.length; if (bytes > 262144) { controller.abort(); fail(); } else chunks.push(chunk); });
        res.on("end", () => {
          clearTimeout(timer);
          try {
            requireReward(res.statusCode === 200 && res.headers["content-type"] === "application/json", "reward_workflow_unavailable");
            const value = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
              z.object({ ok: z.literal(false), code: z.string() }).strict()]).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            if (!value.ok) { reject(Error(codes.has(value.code) ? value.code : "reward_workflow_unavailable")); return; }
            resolve(value.data);
          } catch { fail(); }
        });
      });
      req.on("error", fail); req.end(body);
    });
  } };
}

export async function startWorkflowIpcV3(options: { socketPath: string; host: WorkflowHostV3; signal: AbortSignal;
  authenticate: (actor: RewardAccountIdentity, token: string) => Promise<void> }) {
  const { socketPath, host, signal, authenticate } = options;
  requireReward(!signal.aborted, "reward_workflow_not_configured"); assertWorkflowSocketV3(socketPath, false);
  const server = createServer({ headersTimeout: 10000, requestTimeout: 15000, keepAliveTimeout: 1000 }, async (req, res) => {
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.setHeader("Connection", "close");
    const timer = setTimeout(() => req.destroy(), workflowIpcDeadlineMsV3);
    try {
      requireReward(!signal.aborted && req.method === "POST" && req.url === "/workflow-v3"
        && req.headers["content-type"] === "application/json", "invalid_reward_workflow_request");
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length; requireReward(size <= 32768, "invalid_reward_workflow_request"); chunks.push(chunk);
      }
      const value = envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      await authenticate(value.actor, value.accessToken);
      requireReward(!signal.aborted, "reward_workflow_authority_required");
      const data = await executeWorkflowRequestV3(host, value.actor, value.operation, value.input);
      const body = JSON.stringify({ ok: true, data });
      requireReward(Buffer.byteLength(body) <= 262144, "reward_workflow_unavailable"); res.end(body);
    } catch (e) { if (!res.destroyed) res.end(JSON.stringify({ ok: false, code: safeCode(e) })); }
    finally { clearTimeout(timer); }
  });
  server.maxConnections = 8;
  const closed = new Promise<void>(resolve => server.once("close", resolve));
  const stop = () => { server.close(); server.closeAllConnections(); signal.removeEventListener("abort", stop); };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject); server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    chmodSync(socketPath, 0o600); assertWorkflowSocketV3(socketPath, true);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    server.on("error", stop);
    return { stop, closed };
  } catch (e) { stop(); throw e; }
}
