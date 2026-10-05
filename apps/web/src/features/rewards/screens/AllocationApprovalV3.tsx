import RewardExplorerLink from "../components/RewardExplorerLink";
import RewardDistributionTree from "../components/RewardDistributionTree";
import { allocationPotNode } from "../model/allocationTree";
import { productCopy } from "../model/productCopy";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestAllocationApprovalV3, type AllocationApprovalRequestV3 } from "../data/allocationApprovalV3";
import type { HistoricalReviewContextV3 } from "../data/historicalSourceV3";

type Data = Awaited<ReturnType<typeof requestAllocationApprovalV3>>;
const AllocationUploadV3 = lazy(() => import("./AllocationUploadV3"));
export default function AllocationApprovalV3({ context, dirty }: { context: HistoricalReviewContextV3; dirty: boolean }) {
  const { t, locale } = useI18n(), [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false), [consent, setConsent] = useState(false), [pending, setPending] = useState<AllocationApprovalRequestV3 | null>(null);
  const [page, setPage] = useState(0);
  const generation = useRef(0), sending = useRef(false);
  const uploadContext = useMemo(() => {
    const approved = data?.approval, original = approved?.document;
    // A changed source must not erase existing transaction history on reload.
    // Inspect the original signed-off document, never the replacement preview.
    return approved && original?.binding ? {
      chainId: original.record.chainId, draftId: original.record.draftId, slot: original.slot, approvalId: approved.id,
      contextHash: approved.contextHash, documentHash: approved.documentHash, campaignAddress: original.binding.campaignAddress,
      budgetWei: original.calculation.budgetWei.toString(), allocatedWei: original.calculation.proposedWei.toString(),
      unallocatedWei: original.calculation.retainedWei.toString(), entitlementCount: String(original.recipients.length),
    } : null;
  }, [data?.approval]);
  // The caller keys this panel to Auth, draft, mapping, source decision and slot.
  useEffect(() => {
    const current = ++generation.current;
    void requestAllocationApprovalV3(context).then(v => { if (current === generation.current) setData(v); })
      .catch(() => { if (current === generation.current) setFailed(true); })
      .finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current = current + 1; };
  }, [context]);
  async function act(approve = false) {
    if (sending.current || busy || dirty || (approve && (!consent || !data || data.reasons.length || data.approval?.current))) return;
    const request = pending ?? (approve && data ? { requestId: crypto.randomUUID(), expectedApprovalId: data.approval?.id ?? null,
      contextHash: data.contextHash, documentHash: data.documentHash } : null);
    const current = generation.current;
    sending.current = true; setBusy(true); setFailed(false); setData(null); setConsent(false); setPage(0);
    if (request) setPending(request);
    try { const result = await requestAllocationApprovalV3(context, request ?? undefined);
      if (current === generation.current) { setData(result); setPending(null); }
    } catch { if (current === generation.current) setFailed(true); }
    finally { sending.current = false; if (current === generation.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-md border p-3" aria-label={t("rewards.allocationApproval.title")}>
    <h4 className="font-semibold">{t("rewards.allocationApproval.title")}</h4>
    <p className="text-sm">{t("rewards.allocationApproval.help")}</p>
    {busy ? <p role="status">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert">{t(pending ? "rewards.historical.uncertain" : "rewards.historical.error")}</p> : null}
    {data ? <>
      <p className="text-sm">{t("rewards.historical.totals", { proposed: formatUnits(data.document.calculation.proposedWei, 18), retained: formatUnits(data.document.calculation.retainedWei, 18) })}</p>
      <RewardDistributionTree root={allocationPotNode(data.document.calculation, data.documentHash, t("rewards.athleteV3.round", { round: data.document.slot }), {
        family: key => t(key === "athlete_standings" ? "rewards.distribution.athlete" : "rewards.distribution.club"),
        category: id => id, beneficiary: id => id, remaining: productCopy(locale).remaining,
      })} />
      <p className="text-sm">{t("rewards.allocationApproval.recipients", { count: data.document.recipients.length })}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="text-left">{t("rewards.allocationApproval.recipientList")}</caption>
        <thead><tr><th>{t("rewards.allocationApproval.sourceId")}</th><th>{t("rewards.allocationApproval.amount")}</th></tr></thead>
        <tbody>{data.document.recipients.slice(page * 25, (page + 1) * 25).map(r => <tr key={`${r.beneficiaryKind}:${r.beneficiaryId}`}>
          <td className="break-all py-2 pr-3">{t(r.beneficiaryKind === "athlete" ? "rewards.allocationApproval.athlete" : "rewards.allocationApproval.club")} · {r.beneficiaryId}</td>
          <td className="whitespace-nowrap py-2">{formatUnits(r.amountWei, 18)} MON</td></tr>)}</tbody></table></div>
      {data.document.recipients.length > 25 ? <div className="flex gap-2">
        <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("rewards.allocationApproval.previous")}</button>
        <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={(page + 1) * 25 >= data.document.recipients.length} onClick={() => setPage(p => p + 1)}>{t("rewards.allocationApproval.next")}</button>
      </div> : null}
      {data.document.binding ? <p className="break-all font-mono text-xs">{t("rewards.allocationApproval.contract")} <RewardExplorerLink chainId={data.document.record.chainId} kind="address" value={data.document.binding.campaignAddress}/></p> : null}
      <details className="text-xs"><summary>{t("rewards.historical.evidence")}</summary><p className="break-all font-mono">{data.documentHash}</p></details>
      {data.approval ? <p role="status">{t(data.approval.current ? "rewards.allocationApproval.approved" : "rewards.allocationApproval.stale")}
        {" · "}{new Date(data.approval.approvedAt).toLocaleString(locale)}</p> : null}
      {data.reasons.filter(reason => reason !== "historical_acknowledgement").length ? <p role="status" className="text-sm">{t("rewards.allocationApproval.notReady")}</p> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent}
        disabled={busy || dirty || data.reasons.length > 0 || data.approval?.current === true} onChange={e => setConsent(e.target.checked)} />
        <span>{t("rewards.allocationApproval.confirm")}</span></label>
      <button type="button" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        disabled={busy || dirty || !consent || data.reasons.length > 0 || data.approval?.current === true} onClick={() => void act(true)}>{t("rewards.allocationApproval.save")}</button>
    </> : null}
    {!busy ? <button type="button" className="rounded border px-3 py-2 text-sm disabled:opacity-50" disabled={dirty}
      onClick={() => void act()}>{t(pending ? "rewards.historical.retry" : "rewards.historical.reload")}</button> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.allocationApproval.noPayment")}</p>
    {uploadContext ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
      <AllocationUploadV3 key={uploadContext.approvalId} context={uploadContext} dirty={dirty} />
    </Suspense> : null}
  </section>;
}
