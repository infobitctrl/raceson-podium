import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { requireReward } from "@raceson/domain/rewards";
import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { workflowJobV3, type WorkflowJobV3, type WorkflowRuntimeV3 } from "./workflow-v3-service.js";

const schedule = workflowJobV3.extend({ schema: z.literal("raceson-workflow-schedule-v1"), chainId: z.union([z.literal(31337), z.literal(10143)]),
  userId: z.string().uuid(), workerId: z.string().uuid(), createdAt: z.number().int().nonnegative() }).strict();
export type WorkflowScheduleV3 = z.infer<typeof schedule>;
const progress = z.object({ outcome: z.enum(["scheduled", "confirmed", "busy", "held", "pending", "submitted", "awaiting_nonce", "nonce_conflict",
  "unavailable", "broadcast_unknown", "requires_attention", "awaiting_predecessor", "cancelled", "authorization_required"]),
  attempts: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() }).strict();
type Progress = z.infer<typeof progress>;
const errorCode = (e: unknown) => e && typeof e === "object" && "code" in e ? e.code : undefined;
/** A private persistent local volume is required. Immutable requests + exclusive
 * send markers supplement SQL jobs, never replace their locks or receipt ledger.
 * No sessions, keys, proofs or signed bytes are stored here. */
export class WorkflowScheduleStoreV3 {
  constructor(private readonly directory: string) {
    requireReward(isAbsolute(directory), "reward_workflow_store_required");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    requireReward(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
      && (process.getuid === undefined || stat.uid === process.getuid()), "reward_workflow_store_required");
  }
  private path(jobId: string, suffix: string) { return join(this.directory, `${z.string().uuid().parse(jobId)}.${suffix}.json`); }
  private syncDirectory() { const fd = openSync(this.directory, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private read(path: string): unknown | null {
    try {
      const stat = lstatSync(path);
      requireReward(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size <= 16384, "reward_workflow_store_invalid");
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) { if (errorCode(e) === "ENOENT") return null; throw e; }
  }
  private write(path: string, value: unknown, exclusive: boolean) {
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    try {
      if (exclusive) linkSync(temporary, path); else renameSync(temporary, path);
      this.syncDirectory();
    } finally { try { unlinkSync(temporary); } catch (e) { if (errorCode(e) !== "ENOENT") throw e; } }
  }
  enqueue(userId: string, chainId: 31337 | 10143, input: WorkflowJobV3): WorkflowScheduleV3 {
    const request = workflowJobV3.parse(input), candidate = schedule.parse({ ...request, schema: "raceson-workflow-schedule-v1",
      userId, chainId, workerId: randomUUID(), createdAt: Date.now() });
    const path = this.path(request.jobId, "request");
    try { this.write(path, candidate, true); }
    catch (e) { if (errorCode(e) !== "EEXIST") throw e; }
    const saved = schedule.parse(this.read(path));
    requireReward(saved.userId === userId && saved.chainId === chainId
      && canonicalRewardJson({ target: saved.target, jobId: saved.jobId, transactionHash: saved.transactionHash }) === canonicalRewardJson(request),
    "reward_workflow_job_conflict");
    return saved;
  }
  get(jobId: string) { const raw = this.read(this.path(jobId, "request")); return raw === null ? null : schedule.parse(raw); }
  list() { return readdirSync(this.directory).filter(p => p.endsWith(".request.json")).sort()
    .map(p => schedule.parse(this.read(join(this.directory, p)))); }
  progress(jobId: string): Progress {
    // A separate append-only terminal marker wins over every stale progress
    // write, including a different process that read before confirmation.
    const terminal = this.read(this.path(jobId, "confirmed"));
    if (terminal !== null) {
      const saved = progress.parse(terminal);
      requireReward(saved.outcome === "confirmed", "reward_workflow_store_invalid"); return saved;
    }
    const raw = this.read(this.path(jobId, "progress"));
    return raw === null ? { outcome: "scheduled", attempts: 0, nextAttemptAt: 0, updatedAt: 0 } : progress.parse(raw);
  }
  record(jobId: string, input: Progress) {
    const value = progress.parse(input);
    if (value.outcome === "confirmed") {
      try { this.write(this.path(jobId, "confirmed"), value, true); }
      catch (e) { if (errorCode(e) !== "EEXIST") throw e; }
    } else if (this.progress(jobId).outcome !== "confirmed") {
      this.write(this.path(jobId, "progress"), value, false);
    }
  }
  /** O_EXCL-equivalent atomic link across processes; a crash can only prevent a
   * send, never permit a duplicate. Never delete a marker to retry a job. */
  markSend(record: WorkflowScheduleV3) {
    const r = schedule.parse(record), path = join(this.directory, `send-${r.chainId}-${r.transactionHash}.json`);
    try { this.write(path, { transactionHash: r.transactionHash, jobId: r.jobId }, true); }
    catch (e) { if (errorCode(e) === "EEXIST") throw Error("reward_workflow_reconciliation_required"); throw e; }
  }
}
export async function runWorkflowSchedulerPassV3(store: WorkflowScheduleStoreV3, runtime: Pick<WorkflowRuntimeV3, "chainId" | "deliver">,
  resolveActor: (userId: string) => Promise<RewardAccountIdentity>, options: { maxJobs?: number; signal?: AbortSignal; now?: number } = {}) {
  const maxJobs = options.maxJobs ?? 20, now = options.now ?? Date.now();
  requireReward(Number.isSafeInteger(maxJobs) && maxJobs > 0 && maxJobs <= 100, "invalid_reward_workflow_request");
  const entries: Array<{ jobId: string; outcome: Progress["outcome"] }> = [];
  for (const record of store.list()) {
    if (options.signal?.aborted || entries.length >= maxJobs) break;
    requireReward(record.chainId === runtime.chainId, "reward_workflow_job_conflict");
    const previous = store.progress(record.jobId);
    if (previous.outcome === "confirmed" || previous.nextAttemptAt > now) continue;
    let outcome: Progress["outcome"];
    try {
      const actor = await resolveActor(record.userId);
      requireReward(actor.userId === record.userId, "reward_account_session_required");
      if (options.signal?.aborted) break;
      const observed = await runtime.deliver(actor, record, () => {
        requireReward(!options.signal?.aborted, "reward_workflow_stopped"); store.markSend(record);
      });
      requireReward(observed.jobId === record.jobId, "reward_workflow_job_conflict");
      outcome = progress.shape.outcome.parse(observed.outcome);
    } catch (e) {
      const code = errorCode(e) ?? (e instanceof Error ? e.message : "");
      outcome = ["reward_account_session_required", "reward_workflow_authority_required", "Unauthorized", "forbidden"].includes(String(code))
        ? "authorization_required" : "unavailable";
    }
    const attempts = previous.attempts + 1;
    // Bounded backoff, no busy-looping a provider or expired login. Pending work
    // survives a process restart; a host must supply fresh authorized sessions.
    const delay = Math.min(300000, 5000 * 2 ** Math.min(attempts - 1, 6));
    store.record(record.jobId, { outcome, attempts, updatedAt: Date.now(), nextAttemptAt: Date.now() + delay });
    entries.push({ jobId: record.jobId, outcome });
  }
  return { schema: "raceson-workflow-scheduler-pass-v1" as const, entries };
}
/** Explicit host lifecycle; no import-time timer and no shared-server restart. */
export function startWorkflowSchedulerV3(store: WorkflowScheduleStoreV3, runtime: Parameters<typeof runWorkflowSchedulerPassV3>[1],
  resolveActor: Parameters<typeof runWorkflowSchedulerPassV3>[2], options: { signal: AbortSignal; onError?: () => void; intervalMs?: number }) {
  const interval = options.intervalMs ?? 5000;
  requireReward(Number.isSafeInteger(interval) && interval >= 1000 && interval <= 60000, "invalid_reward_workflow_request");
  const controller = new AbortController(), signal = AbortSignal.any([options.signal, controller.signal]);
  let running = false;
  const tick = async () => {
    if (running || signal.aborted) return;
    running = true;
    try { await runWorkflowSchedulerPassV3(store, runtime, resolveActor, { signal }); }
    catch { try { options.onError?.(); } catch { /* No raw errors in telemetry. */ } }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, interval);
  timer.unref(); const stop = () => {
    clearInterval(timer); controller.abort(); options.signal.removeEventListener("abort", stop);
  };
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop(); else void tick();
  return stop;
}
