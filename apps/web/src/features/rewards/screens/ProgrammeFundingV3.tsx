import RewardExplorerLink from "../components/RewardExplorerLink";
import { productCopy } from "../model/productCopy";
import editorial from "../components/RewardEditorial.module.css";
import { useEffect, useState } from "react";
import { previewRewardProgrammeDraftV2, type SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import type { ProgrammeFundingViewV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readProgrammeFundingV3 } from "../data/programmeFundingV3";
import ProgrammeFundingApprovalV3 from "./ProgrammeFundingApprovalV3";
import ProgrammeDepositV3 from "./ProgrammeDepositV3";

export default function ProgrammeFundingV3({ record }: { record: SavedRewardPlanningDraft }) {
  const { t, locale } = useI18n(), copy = productCopy(locale);
  const [view, setView] = useState<ProgrammeFundingViewV3 | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false); setView(null);
    void readProgrammeFundingV3(record).then(value => { if (active) setView(value); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record, reload]);
  const preview = previewRewardProgrammeDraftV2(record.rules);
  // Never turn absent/failed chain observations into a zero deposit or a usable address.
  const current = view?.draftId === record.draftId && view.rulesRevision === record.revision ? view : null;
  const observed = current?.observation ?? null;
  const mon = (value: string | bigint) => {
    const wei = BigInt(value), unit = 10n ** 18n;
    const fraction = (wei % unit).toString().padStart(18, "0").replace(/0+$/, "");
    return `${new Intl.NumberFormat(locale).format(wei / unit)}${fraction ? `${locale === "hr" ? "," : "."}${fraction}` : ""} MON`;
  };
  const label = (slot: number) => slot === 5 ? t("rewards.fundingV3.league") : t("rewards.fundingV3.round", { round: slot + 1 });
  const values = [...preview.rounds.map(r => r.amountWei), preview.leagueBudgetWei];
  return <section id="programme-funding" aria-labelledby="programme-funding-heading" className={`${editorial.page} ${editorial.funding} space-y-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="programme-funding-heading" className="text-xl font-semibold">{t("rewards.fundingV3.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("rewards.fundingV3.revision", { revision: record.revision })}</p></div>
      <button type="button" className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" disabled={loading} onClick={() => setReload(n => n + 1)}>{t("rewards.fundingV3.refresh")}</button>
    </div>
    <div className={editorial.fundingMetrics}>
      <div><p className="text-sm text-muted-foreground">{t("rewards.fundingV3.planned")}</p><p className="text-2xl font-semibold">{mon(preview.budgetWei)}</p></div>
      <div><p className="text-sm text-muted-foreground">{t("rewards.fundingV3.deposited")}</p><p className="text-xl font-semibold">{observed ? mon(observed.depositedWei) : t("rewards.fundingV3.unverified")}</p></div>
      <div><p className="text-sm text-muted-foreground">{t("rewards.fundingV3.routed")}</p><p className="text-xl font-semibold">{observed ? mon(observed.totalRoutedWei) : t("rewards.fundingV3.unverified")}</p></div>
    </div>
    <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
      <div><dt>{copy.allocated}</dt><dd>{copy.unknownAmount}</dd></div>
      <div><dt>{copy.held}</dt><dd>{copy.unknownAmount}</dd></div>
      <div><dt>{copy.paid}</dt><dd>{observed ? mon(observed.pots.reduce((sum, pot) => sum + BigInt(pot.paidWei), 0n)) : copy.unknownAmount}</dd></div>
      <div><dt>{copy.unallocated}</dt><dd>{copy.unknownAmount}</dd></div>
    </dl><p className="text-sm text-muted-foreground">{copy.balancesHelp}</p>
    {loading ? <p role="status" className="text-sm">{t("rewards.loading")}</p> : null}
    {failed ? <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{t("rewards.fundingV3.error")}</p> : null}
    {current?.status === "awaiting_deployment" ? <div className="rounded-lg border border-dashed p-4">
      <h3 className="font-medium">{t("rewards.fundingV3.awaiting")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("rewards.fundingV3.awaitingHelp")}</p>
    </div> : null}
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("rewards.fundingV3.pots")}>
      {values.map((value, slot) => {
        const pot = observed?.pots[slot];
        return <li key={slot} className={editorial.fundingPot} data-pot={slot === 5 ? "league" : "race"}>
          <h3 className="flex items-baseline gap-1 font-medium">{label(slot)} <span className="text-xs text-muted-foreground">{`${Number(value * 10000n / preview.budgetWei) / 100}%`}</span></h3>
          <progress className={`${editorial.potProgress} w-full`} max={10000} value={Number(value * 10000n / preview.budgetWei)}
            aria-label={`${label(slot)} · ${copy.share}`} />
          <p className="mt-2 text-lg font-semibold">{mon(value)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{pot ? t(pot.routed ? "rewards.fundingV3.sent" : "rewards.fundingV3.notSent") : t("rewards.fundingV3.plannedOnly")}</p>
          {pot ? <details className="mt-3 text-sm"><summary className="cursor-pointer underline">{t("rewards.fundingV3.details")}</summary>
            <dl className="mt-2 space-y-2">
              <div><dt>{t("rewards.fundingV3.paid")}</dt><dd>{mon(pot.paidWei)}</dd></div>
              <div><dt>{t("rewards.fundingV3.retained")}</dt><dd>{mon(pot.remainingWei)}</dd></div>
              <div><dt>{t("rewards.fundingV3.returned")}</dt><dd>{mon(pot.returnedToProgrammeWei)}</dd></div>
              <div><dt>{t("rewards.fundingV3.state")}</dt><dd>{t(`rewards.fundingV3.state.${pot.state}`)}{pot.paused ? ` · ${t("rewards.fundingV3.paused")}` : ""}</dd></div>
              <div><dt>{t("rewards.fundingV3.address")}</dt><dd className="break-all font-mono text-xs"><RewardExplorerLink chainId={record.chainId} kind="address" value={pot.address}/></dd></div>
            </dl></details> : null}
        </li>;
      })}
    </ul>
    {observed ? <details className="text-sm"><summary className="cursor-pointer underline">{t("rewards.fundingV3.evidence")}</summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><dt>{t("rewards.fundingV3.address")}</dt><dd className="break-all font-mono text-xs"><RewardExplorerLink chainId={record.chainId} kind="address" value={observed.address}/></dd></div>
        <div><dt>{t("rewards.fundingV3.transaction")}</dt><dd className="break-all font-mono text-xs">{observed.deploymentTransactionHash}</dd></div>
        <div><dt>{t("rewards.fundingV3.checkpoint")}</dt><dd>{observed.blockNumber}</dd></div>
        <div><dt>{t("rewards.fundingV3.pending")}</dt><dd>{mon(observed.pendingFundingWei)}</dd></div>
        <div><dt>{t("rewards.fundingV3.returned")}</dt><dd>{mon(observed.returnedWei)}</dd></div>
        <div><dt>{t("rewards.fundingV3.stopped")}</dt><dd>{t(observed.fundingAborted ? "common.yes" : "common.no")}</dd></div>
      </dl></details> : null}
    <p className="text-sm text-muted-foreground">{t("rewards.fundingV3.noOperations")}</p>
    <ProgrammeFundingApprovalV3 key={`${record.draftId}:${record.revision}`} record={record} />
    <ProgrammeDepositV3 key={`deposit:${record.draftId}:${record.revision}`} record={record} onConfirmed={() => setReload(n => n + 1)} />
  </section>;
}
