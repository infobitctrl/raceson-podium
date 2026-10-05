import RewardExplorerLink from "../components/RewardExplorerLink";
import { productCopy } from "../model/productCopy";
import ProgrammeWorkflowV3 from "../components/ProgrammeWorkflowV3";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { decodeProgrammeActionFeesV3, nextProgrammeActionV3, type ProgrammeActionRequestV3 } from "@raceson/domain/rewards/programme-actions-v3";
import { programmeExecutionProgressV3, programmeActivationProgressV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { requestProgrammeActionsV3 } from "../data/programmeActionsV3";
import type { ExecutionContextV3 } from "../data/programmeExecutionStatusV3";
import { formatTestMon } from "../model/athleteRewards";

type Props = { context: ExecutionContextV3; dirty: boolean };
type Data = Awaited<ReturnType<typeof requestProgrammeActionsV3>>;
const feeNames = ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"] as const;
const initialFees = { gasLimit: "6000000", maxFeePerGas: "100000000000", maxPriorityFeePerGas: "0" };
const actionKeys = { complete_funding: "close", upload_awards: "batch", stage_allocation: "stage", activate: "activate" } as const;
const effectKeys = { complete_funding: "closeEffect", upload_awards: "uploadEffect", stage_allocation: "stageEffect", activate: "activateEffect" } as const;
export default function ProgrammeActionsV3(props: Props) {
  return <ActionDetails key={JSON.stringify([props.context, props.dirty])} {...props} />;
}
function ActionDetails({ context, dirty }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [consent, setConsent] = useState(false), [fees, setFees] = useState(initialFees);
  const [pending, setPending] = useState<ProgrammeActionRequestV3 | null>(null);
  const generation = useRef(0), sending = useRef(false);
  useEffect(() => { const version = ++generation.current; return () => { generation.current = version + 1; }; }, [context, dirty]);
  let limits = null;
  try { limits = decodeProgrammeActionFeesV3({ ...fees, maxGasCostWei: (BigInt(fees.gasLimit) * BigInt(fees.maxFeePerGas)).toString() }); } catch { /* Invalid editable input is not an action. */ }
  const next = data && nextProgrammeActionV3(data.execution, data.publication), last = data?.execution.steps.at(-1);
  const progress = data && programmeExecutionProgressV3(data.execution), activation = data && programmeActivationProgressV3(data.execution);
  const canQueue = data?.execution.current && last?.state === "signed" && data.selected?.attemptId && !data.selected.jobId;
  async function act(kind?: "prepare" | "queue") {
    if (sending.current || dirty || (kind && (!consent || !data?.execution.current))) return;
    let request = pending;
    if (!request && kind === "prepare") {
      if (!next || !limits) return;
      request = { kind, requestId: crypto.randomUUID(), expectedPredecessorId: next.predecessorId, packageHash: context.packageHash, fees: limits };
    } else if (!request && kind === "queue") {
      if (!canQueue || !data?.selected?.attemptId || !last?.transactionHash) return;
      request = { kind, requestId: crypto.randomUUID(), intentId: data.selected.intentId, attemptId: data.selected.attemptId,
        transactionHash: last.transactionHash, packageHash: context.packageHash };
    }
    const version = generation.current; sending.current = true; setBusy(true); setFailed(false); setData(null); setConsent(false);
    if (request) setPending(request);
    try { const result = await requestProgrammeActionsV3(context, request ?? undefined);
      if (version === generation.current) { setData(result); setPending(null); }
    } catch { if (version === generation.current) setFailed(true); }
    finally { sending.current = false; if (version === generation.current) setBusy(false); }
  }
  const disabled = busy || dirty, selected = data?.selected;
  return <section className="space-y-3 rounded-md border bg-background p-3" aria-label={t("rewards.actions.title")}>
    <h6 className="font-semibold">{t("rewards.actions.title")}</h6>
    <p className="text-sm text-muted-foreground">{t("rewards.actions.help")}</p>
    <button type="button" disabled={disabled} onClick={() => void act()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">
      {t(pending ? "rewards.actions.retry" : "rewards.actions.refresh")}</button>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t(pending ? "rewards.actions.uncertain" : "rewards.execution.error")}</p> : null}
    {data ? <>
      {!data.execution.current ? <p role="status">{t("rewards.execution.held")}</p> : null}
      <ol className="grid gap-2 text-sm sm:grid-cols-2" aria-label={t("rewards.actions.journey")}>
        {([
          ["uploaded", progress?.uploadComplete], ["published", Boolean(data.publication?.publication)],
          ["staged", activation?.staged], ["activated", activation?.activated],
        ] as const).map(([label, done], index) => <li key={label} className="min-w-0 rounded border p-3">
          <p className="font-semibold">{index + 1}. {t(`rewards.actions.journey.${label}`)}</p>
          <p className="text-muted-foreground">{t(done ? "rewards.actions.recorded" : "rewards.actions.waiting")}</p>
        </li>)}
      </ol>
      {progress?.uploadComplete && !data.publication?.publication ? <p role="status" className="text-sm">{t("rewards.actions.awaitPublication")}
        {data.publication?.review ? ` ${t("rewards.actions.reviewEnd", { date: new Date(data.publication.review.endsAt).toLocaleString(locale) })}` : null}</p> : null}
      {selected && last ? <div className="space-y-2 text-sm">
        <p className="font-semibold">{t(`rewards.execution.state.${last.state}`)}</p>
        <p>{t(`rewards.execution.${actionKeys[last.action]}`,
          { start: (last.batchStart ?? 0) + 1, end: (last.batchStart ?? 0) + (last.batchSize ?? 0) })}</p>
        <p>{t("rewards.actions.ceiling", { amount: formatTestMon(selected.fees.maxGasCostWei, locale) })}</p>
        <details><summary className="cursor-pointer">{t("rewards.actions.reference")}</summary>
          <dl className="space-y-1 break-all text-xs">
            <dt>{t("rewards.actions.operator")}</dt><dd className="font-mono"><RewardExplorerLink chainId={context.chainId} kind="address" value={selected.operatorAddress}/></dd>
            <dt>{t("rewards.actions.nonce")}</dt><dd>{selected.nonce}</dd>
            <dt>{t("rewards.actions.intent")}</dt><dd className="font-mono">{selected.intentId}</dd>
            {feeNames.map(name => <div key={name}><dt>{t(`rewards.actions.${name}`)}</dt><dd>{selected.fees[name]}</dd></div>)}
            {last.transactionHash ? <><dt>{t("rewards.execution.transaction")}</dt><dd className="font-mono">{last.transactionHash}</dd></> : null}
            {selected.jobId ? <><dt>{t("rewards.actions.job")}</dt><dd className="font-mono">{selected.jobId}</dd></> : null}
          </dl>
        </details>
        {last.state === "reserved" ? <p>{productCopy(locale).awaitingOperator}</p> : null}
        {selected.jobId && last.state !== "confirmed" ? <p>{t("rewards.actions.awaitOperator")}</p> : null}
      </div> : null}
      {next ? <div className="space-y-3 rounded border p-3">
        <p className="font-semibold">{t(`rewards.execution.${actionKeys[next.action]}`,
          { start: (next.batchStart ?? 0) + 1, end: (next.batchStart ?? 0) + (next.batchSize ?? 0) })}</p>
        <p className="text-sm">{t(`rewards.actions.${effectKeys[next.action]}`)}</p>
        <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={context.chainId} kind="address" value={data.execution.campaignAddress}/></p>
        <p className="text-sm text-muted-foreground">{t("rewards.actions.feeHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-3">{feeNames.map(name => <label key={name} className="min-w-0 space-y-1 text-sm">
          <span>{t(`rewards.actions.${name}`)}</span><input className="w-full min-w-0 rounded border bg-background px-2 py-2" inputMode="numeric"
            value={fees[name]} maxLength={78} disabled={disabled} onChange={event => { setFees(v => ({ ...v, [name]: event.target.value })); setConsent(false); }} />
        </label>)}</div>
        <p className="text-sm" role="status">{limits ? t("rewards.actions.ceiling", { amount: formatTestMon(limits.maxGasCostWei, locale) }) : t("rewards.actions.invalidFees")}</p>
      </div> : null}
      {next || canQueue ? <>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={disabled || Boolean(next && !limits)}
          onChange={event => setConsent(event.target.checked)} /><span>{t(canQueue ? "rewards.actions.queueConsent" : "rewards.actions.prepareConsent")}</span></label>
        <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={disabled || !consent || Boolean(next && !limits)} onClick={() => void act(canQueue ? "queue" : "prepare")}>
          {t(canQueue ? "rewards.actions.queue" : "rewards.actions.prepare")}</button>
      </> : null}
      {selected && last && data.execution.current && last.state !== "confirmed" ? <ProgrammeWorkflowV3 key={selected.intentId}
        target={{ kind: "programme", draftId: context.draftId, slot: context.slot, approvalId: context.approvalId, uploadId: context.uploadId,
          intentId: selected.intentId, attemptId: selected.attemptId }} chainId={context.chainId} jobId={selected.jobId}
        transactionHash={last.transactionHash} onSigned={() => void act()} /> : null}
      {activation?.activated ? <p role="status">{t("rewards.execution.activated")}</p> : null}
    </> : null}
    <p className="text-sm text-muted-foreground">{productCopy(locale).actionBoundary}</p>
  </section>;
}
