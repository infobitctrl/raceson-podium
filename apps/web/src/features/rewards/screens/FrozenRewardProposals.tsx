import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { rewardProposalReadinessV2, type FrozenRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import { useI18n } from "@/shared/i18n/I18nContext";
import { requestFrozenProposals, type FrozenProposalContext } from "../data/frozenProposals";

export default function FrozenRewardProposals({ context, dirty }: { context: FrozenProposalContext; dirty: boolean }) {
  const { t, locale } = useI18n(), [items, setItems] = useState<FrozenRewardProposalV2[]>([]), [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [saved, setSaved] = useState(false);
  const live = useRef(false), sending = useRef(false);
  // Parent keys this instance to exact draft/rules/map/source/round. A changed
  // context cannot reuse an in-flight write, confirmation or historical selection.
  useEffect(() => {
    live.current = true;
    void requestFrozenProposals(context).then(data => { if (live.current) { setItems(data); setSelected(data[0]?.revision ?? 0); } })
      .catch(() => { if (live.current) setFailed(true); }).finally(() => { if (live.current) setLoading(false); });
    return () => { live.current = false; };
  }, [context]);
  async function freeze() {
    if (sending.current || dirty || loading) return;
    sending.current = true; setBusy(true); setFailed(false); setSaved(false);
    try {
      const result = await requestFrozenProposals(context, true);
      if (live.current) { setItems(old => [result[0], ...old.filter(r => r.revision !== result[0].revision)].slice(0, 10)); setSelected(result[0].revision); setSaved(true); }
    } catch { if (live.current) setFailed(true); }
    finally { sending.current = false; if (live.current) setBusy(false); }
  }
  const item = items.find(r => r.revision === selected) ?? items[0];
  const old = item && (item.document.record.revision !== context.record.revision || item.document.workspace.revision !== context.workspace.revision
    || item.document.workspace.catalogueHash !== context.workspace.catalogueHash || item.document.sourceHash !== context.sourceHash);
  return <section aria-label={t("rewards.frozen.title")} className="space-y-3 rounded-lg border p-3">
    <h4 className="text-lg font-semibold">{t("rewards.frozen.title")}</h4>
    <p className="text-sm">{t("rewards.frozen.help")}</p>
    <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy || loading || dirty}
      onClick={() => void freeze()}>{t(busy ? "rewards.frozen.saving" : "rewards.frozen.freeze")}</button>
    {dirty ? <p role="status" className="text-sm">{t("rewards.published.savedOnly")}</p> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{t("rewards.frozen.error")}</p> : null}
    {saved ? <p role="status" className="text-sm">{t("rewards.frozen.saved")}</p> : null}
    {loading ? <p role="status">{t("rewards.loading")}</p> : !items.length ? <p className="text-sm">{t("rewards.frozen.empty")}</p> : null}
    {item ? <>
      <label className="block text-sm">{t("rewards.frozen.history")}<select className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={item.revision} onChange={e => setSelected(Number(e.target.value))}>
        {items.map(r => <option key={r.revision} value={r.revision}>{t("rewards.frozen.revision", { revision: r.revision })} · {new Date(r.frozenAt).toLocaleString(locale)}</option>)}
      </select></label>
      <p className="text-sm font-medium">{t(old ? "rewards.frozen.older" : "rewards.frozen.current")}</p>
      <p className="text-sm">{t("rewards.frozen.binding", { rules: item.document.record.revision, mapping: item.document.workspace.revision })}</p>
      <p className="rounded-md bg-muted p-3 text-sm">{t("rewards.frozen.review")}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">{rewardProposalReadinessV2(item.document).reasons.map(reason => <li key={reason}>{t(`rewards.frozen.block.${reason}`)}</li>)}</ul>
      <p className="text-sm">{t("rewards.frozen.totals", { proposed: formatUnits(item.document.calculation.proposedWei, 18), retained: formatUnits(item.document.calculation.retainedWei, 18) })}</p>
      <details><summary className="cursor-pointer text-sm font-medium text-primary">{t("rewards.frozen.inspect")}</summary>
        {item.document.calculation.categories.map(category => <div key={category.categoryId} className="my-3 space-y-1 border-t pt-2 text-sm">
          <h5 className="font-medium">{category.label}</h5>
          <p>{t("rewards.published.categoryBudget", { budget: formatUnits(category.budgetWei, 18), unused: formatUnits(category.unusedWei, 18) })}</p>
          {category.blockedReason ? <p>{t(`rewards.published.block.${category.blockedReason}`)}</p> : category.awards.filter(a => a.amountWei > 0n).map(a => <p key={a.beneficiaryId} className="break-words">{a.place}. {a.name ?? t("rewards.published.hiddenName")} · {formatUnits(a.amountWei, 18)} test MON</p>)}
        </div>)}
      </details>
      <details className="text-xs"><summary className="cursor-pointer">{t("rewards.frozen.digest")}</summary><p className="break-all font-mono">{item.proposalHash}</p><p>{t("rewards.frozen.digestHelp")}</p></details>
    </> : null}
  </section>;
}
