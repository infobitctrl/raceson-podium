import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { programmeExecutionProgressV3, programmeActivationProgressV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { requestProgrammeExecutionStatusV3, type ExecutionContextV3 } from "../data/programmeExecutionStatusV3";
import { formatTestMon } from "../model/athleteRewards";

type Data = Awaited<ReturnType<typeof requestProgrammeExecutionStatusV3>>;
type Props = { context: ExecutionContextV3; dirty: boolean };
const actionKeys = { complete_funding: "close", upload_awards: "batch", stage_allocation: "stage", activate: "activate" } as const;
export default function ProgrammeExecutionStatusV3(props: Props) {
  return <ExecutionDetails key={JSON.stringify([props.context, props.dirty])} {...props} />;
}
function ExecutionDetails({ context, dirty }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(25), generation = useRef(0), reading = useRef(false);
  // Lazy explicit reads only. The enclosing planner remounts on Auth changes;
  // bind results to this immutable allocation as well, including late replies.
  useEffect(() => { const version = ++generation.current; return () => { generation.current = version + 1; }; }, [context, dirty]);
  async function refresh() {
    if (reading.current || dirty) return;
    reading.current = true; const version = generation.current;
    setBusy(true); setFailed(false); setData(null);
    try { const next = await requestProgrammeExecutionStatusV3(context); if (version === generation.current) { setData(next); setVisible(25); } }
    catch { if (version === generation.current) setFailed(true); }
    finally { reading.current = false; if (version === generation.current) setBusy(false); }
  }
  const shown = dirty ? null : data, progress = shown && programmeExecutionProgressV3(shown);
  return <section className="space-y-3 rounded-md border bg-background p-3" aria-label={t("rewards.execution.title")}>
    <h6 className="font-semibold">{t("rewards.execution.title")}</h6>
    <p className="text-sm text-muted-foreground">{t("rewards.execution.help")}</p>
    <button type="button" disabled={busy || dirty} onClick={() => void refresh()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">
      {t("rewards.execution.refresh")}</button>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t("rewards.execution.error")}</p> : null}
    {shown && progress ? <>
      {!shown.current ? <p role="status" className="text-sm">{t("rewards.execution.held")}</p> : null}
      <p className="text-sm font-semibold" role="status">{t("rewards.execution.progress", { uploaded: progress.uploaded, count: Number(shown.entitlementCount) })}</p>
      <progress className="w-full" aria-label={t("rewards.execution.uploadProgress")} value={progress.uploaded} max={Math.max(1, Number(shown.entitlementCount))} />
      <p className="text-sm">{t(programmeActivationProgressV3(shown).activated ? "rewards.execution.activated"
        : programmeActivationProgressV3(shown).staged ? "rewards.execution.staged"
          : progress.uploadComplete ? "rewards.execution.complete" : progress.fundingClosed ? "rewards.execution.closed" : "rewards.execution.open")}</p>
      {!shown.steps.length ? <p className="text-sm">{t("rewards.execution.empty")}</p> : <ol className="space-y-3">
        {shown.steps.slice(0, visible).map(step => <li key={step.intentId} className="space-y-2 rounded border p-3 text-sm">
          <p className="font-semibold">{step.step + 1}. {t(`rewards.execution.${actionKeys[step.action]}`,
            { start: (step.batchStart ?? 0) + 1, end: (step.batchStart ?? 0) + (step.batchSize ?? 0) })}</p>
          <p>{t(`rewards.execution.state.${step.state}`)}</p>
          {step.transactionHash ? <details><summary className="cursor-pointer">{t("rewards.execution.transaction")}</summary>
            <p className="break-all font-mono text-xs">{step.transactionHash}</p>
            {shown.chainId === 10143 ? <a className="underline" target="_blank" rel="noopener noreferrer"
              href={`https://testnet.monadscan.com/tx/${step.transactionHash}`}>{t("rewards.execution.explorer")}</a> : null}
          </details> : null}
          {step.receipt ? <dl className="grid gap-1 text-xs">
            <div><dt className="inline">{t("rewards.execution.block")}: </dt><dd className="inline">{step.receipt.blockNumber}</dd></div>
            <div><dt className="inline">{t("rewards.execution.fee")}: </dt><dd className="inline">{formatTestMon(step.receipt.feeWei, locale)} MON</dd></div>
            <div><dt className="inline">{t("rewards.execution.recorded")}: </dt><dd className="inline">{new Date(step.receipt.recordedAt).toLocaleString(locale)}</dd></div>
          </dl> : null}
        </li>)}
      </ol>}
      {shown.steps.length > visible ? <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setVisible(n => n + 25)}>{t("rewards.execution.more")}</button> : null}
    </> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.execution.noPayment")}</p>
  </section>;
}
