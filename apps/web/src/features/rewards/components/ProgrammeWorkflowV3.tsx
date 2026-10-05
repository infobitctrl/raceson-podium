import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { productCopy } from "../model/productCopy";
import { formatTestMon } from "../model/athleteRewards";
import { inspectWorkflow, scheduleWorkflow, type ProgrammeWorkflowTarget } from "../data/workflowV3";

export default function ProgrammeWorkflowV3({ target, chainId, jobId, transactionHash, onSigned }: {
  target: Omit<ProgrammeWorkflowTarget, "attemptId"> & { attemptId: string | null }; chainId: number;
  jobId: string | null; transactionHash: string | null; onSigned: () => void;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale);
  // Parent keys by immutable intent. A lost response retries this same attempt.
  const [attemptId] = useState(() => target.attemptId ?? crypto.randomUUID());
  const fixed = { ...target, attemptId: target.attemptId ?? attemptId };
  const binding = JSON.stringify([fixed, chainId, jobId, transactionHash]);
  const [view, setView] = useState<Awaited<ReturnType<typeof inspectWorkflow>> | null>(null);
  const [job, setJob] = useState<Awaited<ReturnType<typeof scheduleWorkflow>> | null>(null);
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const flight = useRef<number | null>(null), epoch = useRef(0);
  useEffect(() => { const ticket = ++epoch.current; setView(null); setJob(null); setChecked(false); setFailed(false); setBusy(false); flight.current = null; return () => { epoch.current = ticket + 1; }; }, [binding]);
  async function act(operation: "inspect" | "sign" | "schedule" | "status") {
    if (flight.current !== null || (operation === "sign" || operation === "schedule") && !checked) return;
    const ticket = epoch.current; flight.current = ticket; setBusy(true); setFailed(false); setChecked(false); setJob(null);
    try {
      if (operation === "schedule" || operation === "status") {
        if (!jobId || !transactionHash) return;
        const result = await scheduleWorkflow(fixed, chainId, jobId, transactionHash, operation === "status");
        if (ticket === epoch.current) setJob(result);
      } else {
        const hash = operation === "sign" ? view?.plan.planHash : undefined;
        if (operation === "sign" && !hash) return;
        setView(null);
        const result = await inspectWorkflow(fixed, chainId, hash);
        if (ticket === epoch.current) { setView(result); if (result.recorded) onSigned(); }
      }
    } catch { if (ticket === epoch.current) setFailed(true); }
    finally { if (ticket === epoch.current) { flight.current = null; setBusy(false); } }
  }
  const amount = (v: string) => v === "0" ? "0" : formatTestMon(v, locale);
  const workerHeld = job?.scheduler && ["held", "nonce_conflict", "unavailable", "broadcast_unknown", "requires_attention", "cancelled"].includes(job.scheduler.outcome);
  return <section className="space-y-3 rounded border p-3" aria-label={copy.execution}>
    <h3 className="font-semibold">{copy.execution}</h3>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(jobId ? "status" : "inspect")}>{jobId ? copy.executionStatus : copy.inspectPlan}</Button>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="text-sm">{copy.unavailable}</p> : null}
    {view ? <>
      <dl className="space-y-2 text-sm">
        <div><dt>{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={chainId} kind="address" value={view.plan.campaignAddress}/></dd></div>
        <div><dt>{t("rewards.actions.operator")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={chainId} kind="address" value={view.plan.operatorAddress}/></dd></div>
        <div><dt>{t("rewards.claim.network")}</dt><dd>{chainId}</dd></div>
        <div><dt>{copy.allocated}</dt><dd>{amount(view.plan.allocatedWei)} {t("rewards.testMon")}</dd></div>
      </dl><p>{t("rewards.actions.ceiling", { amount: amount(view.plan.fees.maxGasCostWei) })}</p>
      <details><summary className="cursor-pointer text-sm">{copy.planHash}</summary><p className="break-all font-mono text-xs">{view.plan.planHash}</p></details>
      {view.recorded ? <p role="status">{copy.signed}</p> : <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />{copy.signConfirm}</label>
        <Button disabled={busy || !checked} onClick={() => void act("sign")}>{copy.signPlan}</Button>
      </>}
    </> : null}
    {jobId && transactionHash ? <>
      <p className="break-all font-mono text-xs">{transactionHash}</p>
      {job ? <p role="status">{job.confirmed ? t("rewards.execution.state.confirmed") : job.scheduled ? copy.scheduled : t(`rewards.execution.state.${job.state}`)}</p> : null}
      {job && !job.confirmed && job.reconciliationRequired ? <p role="status" className="text-sm">{copy.reconciliationRequired}</p> : null}
      {job && !job.confirmed && job.scheduler?.outcome === "authorization_required" ? <p role="alert" className="text-sm">{copy.operatorSessionRequired}</p> : null}
      {job && !job.confirmed && workerHeld ? <p role="alert" className="text-sm">{copy.executionHeld}</p> : null}
      {job && !job.scheduled && !job.confirmed && !job.reconciliationRequired ? <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />{copy.scheduleConfirm}</label>
        <Button disabled={busy || !checked} onClick={() => void act("schedule")}>{copy.schedule}</Button>
      </> : null}
    </> : null}
  </section>;
}
