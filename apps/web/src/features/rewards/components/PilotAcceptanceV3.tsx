import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { decodePilotViewV3, type PilotRoundV3, type PilotViewV3 } from "@raceson/domain/rewards/pilot-acceptance-v3";
import { apiRequest } from "@/lib/api";
import { useI18n } from "@/shared/i18n/I18nContext";
import { Button } from "@/components/ui/button";
import { formatTestMon } from "../model/athleteRewards";

export default function PilotAcceptanceV3() {
  const { t, locale } = useI18n();
  const [round, setRound] = useState<PilotRoundV3>(2), [view, setView] = useState<PilotViewV3 | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [checked, setChecked] = useState(false);
  const [refresh, setRefresh] = useState(0), epoch = useRef(0), flight = useRef(false);
  const path = `/v1/organizer/rewards/local-pilot/${round}`;
  useEffect(() => {
    const ticket = ++epoch.current; setView(null); setChecked(false); setFailed(false); setBusy(true);
    void apiRequest<unknown>({ path, cache: "no-store" }).then(value => {
      if (ticket === epoch.current) setView(decodePilotViewV3(value, round));
    }).catch(() => { if (ticket === epoch.current) setFailed(true); })
      .finally(() => { if (ticket === epoch.current) setBusy(false); });
    return () => { epoch.current++; };
  }, [path, round, refresh]);
  async function advance() {
    if (flight.current || busy || !checked || !view?.nextAction) return;
    const ticket = epoch.current, body = { action: view.nextAction, viewHash: view.viewHash };
    flight.current = true; setBusy(true); setFailed(false); setChecked(false);
    try {
      const value = await apiRequest<unknown>({ path, method: "POST", body, cache: "no-store" });
      if (ticket === epoch.current) setView(decodePilotViewV3(value, round));
    } catch { if (ticket === epoch.current) { setView(null); setFailed(true); } }
    finally { flight.current = false; if (ticket === epoch.current) setBusy(false); }
  }
  const mon = (value: string) => value === "0" ? "0" : formatTestMon(value, locale);
  return <section id="testnet-pilot" aria-labelledby="pilot-title" className="mx-auto my-6 max-w-[1320px] scroll-mt-48 sm:scroll-mt-32 space-y-5 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("rewards.pilot.badge")}</p>
        <h2 id="pilot-title" className="mt-1 text-2xl font-semibold">{t("rewards.pilot.title")}</h2></div>
      <Button variant="outline" disabled={busy} onClick={() => setRefresh(n => n + 1)}>{t("rewards.pilot.refresh")}</Button>
    </div>
    <p className="max-w-3xl text-sm text-muted-foreground">{t("rewards.pilot.help")}</p>
    <label className="block max-w-sm text-sm font-medium">{t("rewards.pilot.round")}
      <select className="mt-2 block w-full rounded-md border bg-background p-2" value={round} disabled={busy}
        onChange={e => setRound(Number(e.target.value) as PilotRoundV3)}>
        <option value={2}>{t("rewards.pilot.round2")}</option><option value={3}>{t("rewards.pilot.round3")}</option>
        <option value={4}>{t("rewards.pilot.round4")}</option>
      </select></label>
    {busy ? <p role="status">{t("rewards.pilot.busy")}</p> : null}
    {failed ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{t("rewards.pilot.error")}</p> : null}
    {view ? <>
      <dl className="grid gap-3 sm:grid-cols-3">
        {([["rewards.pilot.pot", view.budgetWei], ["rewards.pilot.allocated", view.allocatedWei], ["rewards.pilot.reserve", view.unallocatedWei]] as const).map(([label, value]) =>
          <div key={label!} className="rounded-lg bg-secondary/50 p-4"><dt className="text-sm text-muted-foreground">{t(label!)}</dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums">{value === null ? "—" : mon(value!)} <span className="text-xs">{t("rewards.testMon")}</span></dd></div>)}
      </dl>
      <p className="text-sm">{t("rewards.pilot.policy")}</p>
      <ol className="grid gap-2 sm:grid-cols-4" aria-label={t("rewards.pilot.chainSteps")}>
        {(["complete_funding", "upload_awards", "stage_allocation", "activate"] as const).map((action, index) => {
          const step = view.steps.find(s => s.action === action);
          return <li key={action} className={`min-w-0 rounded-lg border p-3 ${step?.state === "confirmed" ? "border-primary/40 bg-primary/5" : "border-border"}`}>
            <p className="text-sm font-semibold">{index + 1}. {t(`rewards.pilot.action.${action}`)}</p>
            <p className="mt-2 text-xs">{t(step?.state === "confirmed" ? "rewards.pilot.confirmed" : step ? "rewards.pilot.pending" : "rewards.pilot.notStarted")}</p>
            {step?.transactionHash ? <a className="mt-2 block text-xs text-primary underline" target="_blank" rel="noreferrer"
              href={`https://testnet.monadvision.com/tx/${step.transactionHash}`}>{t("rewards.pilot.receipt")}</a> : null}
          </li>;
        })}
      </ol>
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">{t("rewards.pilot.athlete")}</h3>
        <p className="text-xl font-semibold">{view.athleteAmountWei ? `${mon(view.athleteAmountWei)} ${t("rewards.testMon")}` : t("rewards.pilot.notPrepared")}</p>
        <p role="status" className="text-sm">{t(view.paid ? "rewards.pilot.paid" : view.expired ? "rewards.pilot.expired" : view.held ? "rewards.pilot.held" :
          view.waitingForConsent ? "rewards.pilot.consent" : view.operatorApproved ? "rewards.pilot.approved" : view.recipientConsented ? "rewards.pilot.operator" : "rewards.pilot.notPrepared")}</p>
        {view.paymentTransactionHash ? <a className="block text-sm text-primary underline" target="_blank" rel="noreferrer"
          href={`https://testnet.monadvision.com/tx/${view.paymentTransactionHash}`}>{t("rewards.pilot.paymentReceipt")}</a> : null}
        <Link className="block text-sm text-primary underline" to="/athlete/rewards">{t("rewards.pilot.openAthlete")}</Link>
      </div>
      {view.nextAction ? <div className="space-y-3 rounded-lg bg-primary/5 p-4">
        <h3 className="font-semibold">{t(`rewards.pilot.action.${view.nextAction}`)}</h3>
        <p className="text-sm">{t(`rewards.pilot.help.${view.nextAction}`)}</p>
        <p className="text-xs">{t("rewards.pilot.gas", { amount: mon(view.maximumActionGasWei) })}</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={busy}
          onChange={e => setChecked(e.target.checked)} /><span>{t("rewards.pilot.confirmStep")}</span></label>
        <Button disabled={busy || !checked} onClick={() => void advance()}>{t(`rewards.pilot.action.${view.nextAction}`)}</Button>
      </div> : null}
      <details className="text-sm"><summary className="cursor-pointer">{t("rewards.pilot.details")}</summary>
        <dl className="mt-3 space-y-2 break-all"><dt>{t("rewards.claim.contract")}</dt><dd className="font-mono"><RewardExplorerLink chainId={view.chainId} kind="address" value={view.campaignAddress}/></dd>
          <dt>{t("rewards.claim.destination")}</dt><dd className="font-mono"><RewardExplorerLink chainId={view.chainId} kind="address" value={view.recipientAddress}/></dd></dl>
        <p className="mt-3 text-muted-foreground">{t("rewards.pilot.recorded")}</p></details>
    </> : null}
  </section>;
}
