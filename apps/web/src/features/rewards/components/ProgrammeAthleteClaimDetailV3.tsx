import {walletActionLabel} from "../model/walletActionLabel";
import RewardClaimChecklist from "./RewardClaimChecklist";
import {athleteClaimSteps} from "../model/claimWorkflow";
import { productCopy } from "../model/productCopy";
import { useEffect, useRef, useState } from "react";
import type { AthleteConsentRecordV3, AthleteConsentReviewV3, AthleteConsentSelectionV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { athleteConsentSigningJsonV3 } from "@raceson/rewards-chain/athlete-consent-v3";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getAthleteConsentReviewV3 } from "../data/athleteConsentV3";
import { createBrowserAthleteConsentV3, type AthleteConsentProgressV3 } from "../data/browserAthleteConsentV3";
import { type DetectedRewardWallet } from "../data/browserWallet";
import { useRewardEmbeddedWallet, useRewardWallets } from "./RewardEmbeddedWalletContext";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import { getAthletePaymentStatusV3 } from "../data/athletePaymentStatusV3";
import type { AthletePaymentStatusV3 } from "../model/athletePaymentStatusV3";
import { formatTestMon, rewardErrorKey } from "../model/athleteRewards";
import { athleteUxCopy } from "../model/athleteUxCopy";
import RewardExplorerLink from "./RewardExplorerLink";

export default function ProgrammeAthleteClaimDetailV3({ claim, selection, mode, onRecorded, onAccessLost, onClose }: {
  claim: AthleteConsentRecordV3; selection: AthleteConsentSelectionV3 | null; mode: "consent" | "payment";
  onRecorded: () => void; onAccessLost: (error: unknown) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale), ux = athleteUxCopy(locale);
  // Parent keys this component by exact scope/window/mode; retain one immutable
  // view while a background list refresh returns equivalent new objects.
  const [fixed] = useState(() => ({ claim: { ...claim }, selection: selection ? { ...selection } : null }));
  const [review, setReview] = useState<AthleteConsentReviewV3 | null>(null), [payment, setPayment] = useState<AthletePaymentStatusV3 | null>(null);
  const [progress, setProgress] = useState<AthleteConsentProgressV3 | null>(null), [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<"sign" | "save" | null>(null), [stopped, setStopped] = useState(false);
  const [external, setExternal] = useState(false);
  const embedded = useRewardEmbeddedWallet();
  const wallets = useRewardWallets(external && mode === "consent").filter(wallet => wallet.id !== embedded.wallet?.id);
  const [wallet, setWallet] = useState<DetectedRewardWallet | null>(null);
  const [checked, setChecked] = useState(false), [now, setNow] = useState(Date.now), [refresh, setRefresh] = useState(0);
  const epoch = useRef(0), flight = useRef(false), flow = useRef<ReturnType<typeof createBrowserAthleteConsentV3> | null>(null);
  const region = useRef<HTMLElement | null>(null), lost = useRef(onAccessLost); lost.current = onAccessLost;
  useEffect(() => {
    const ticket = ++epoch.current, abort = new AbortController(); region.current?.focus();
    setLoading(true); setReview(null); setPayment(null); setProgress(null); setError(null); setStopped(false); setWallet(null); setChecked(false);
    const timer = mode === "consent" ? setInterval(() => setNow(Date.now()), 1000) : null;
    const current = () => epoch.current === ticket && !abort.signal.aborted;
    void (async () => {
      try {
        if (mode === "payment") {
          const value = await getAthletePaymentStatusV3(fixed.claim); if (current()) setPayment(value);
        } else if (fixed.selection) {
          const value = await getAthleteConsentReviewV3(fixed.selection); if (!current()) return;
          flow.current = createBrowserAthleteConsentV3(fixed.selection, value, abort.signal, current, () => {
            if (current()) { setStopped(true); setProgress(null); setChecked(false); setWallet(null); setError({ code: "wallet_changed" }); }
          });
          setReview(value); setProgress(flow.current.progress());
        }
      } catch (failure) {
        if (current()) { setError(failure); if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) lost.current(failure); }
      } finally { if (current()) setLoading(false); }
    })();
    return () => { epoch.current += 1; abort.abort(); if (timer !== null) clearInterval(timer); flow.current?.dispose(); flow.current = null; flight.current = false; };
  }, [fixed, mode, refresh]);
  async function act(kind: "sign" | "save") {
    if (flight.current || stopped || !flow.current || kind === "sign" && (!wallet || !checked)) return;
    const ticket = epoch.current; flight.current = true; setBusy(kind); setError(null);
    try {
      if (kind === "sign") {
        const collected = await flow.current.collect(wallet!.provider);
        if (epoch.current !== ticket) return;
        setProgress(collected);
        if (collected.recipientConsented) { onRecorded(); return; }
        setBusy("save");
      }
      // One explicit Claim action signs in the wallet and records that consent.
      // A failed save retains the in-memory signature for the existing retry.
      const value = await flow.current.submit();
      if (epoch.current === ticket) { setProgress(value); if (value.recipientConsented) onRecorded(); }
    } catch (failure) {
      if (epoch.current === ticket) { setError(failure); if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) onAccessLost(failure); }
    } finally { if (epoch.current === ticket) { flight.current = false; setBusy(null); } }
  }
  const expired = fixed.claim.chainId === 10143 && BigInt(Math.floor(now / 1000)) >= BigInt(fixed.claim.expiresAt);
  const expiryDate = new Date(Number(fixed.claim.expiresAt) * 1000);
  const expiry = fixed.claim.chainId === 31337 || !Number.isFinite(expiryDate.getTime()) ? fixed.claim.expiresAt
    : new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zagreb" }).format(expiryDate);
  return <section ref={region} tabIndex={-1} aria-labelledby="programme-claim-detail-v3-title" className="min-w-0 space-y-4 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="programme-claim-detail-v3-title" className="text-lg font-semibold">{mode === "consent" ? ux.claim : t("rewards.payment.title")}</h3>
      <div className="flex flex-wrap gap-2">
        {mode === "consent" && (error || stopped) ? <Button size="sm" variant="outline" disabled={loading || busy !== null} onClick={() => setRefresh(n => n + 1)}>{copy.refreshReview}</Button> : null}
        {mode === "payment" ? <Button size="sm" variant="outline" disabled={loading} onClick={() => {
          setRefresh(n => n + 1);
          // Refresh the containing award/history as well as this detail. A
          // confirmed detail must not leave the award saying "not prepared".
          onRecorded();
        }}>{t("rewards.payment.refresh")}</Button> : null}
        <Button size="sm" variant="ghost" onClick={onClose}>{t("rewards.claim.close")}</Button>
      </div>
    </div>
    <p className="break-words text-2xl font-bold tabular-nums">{formatTestMon(fixed.claim.amountWei, locale)} <span className="text-sm">{t("rewards.testMon")}</span></p>
    <dl className="space-y-3 text-sm">
      <div><dt className="text-muted-foreground">{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={fixed.claim.chainId} kind="address" value={fixed.claim.recipientAddress}/></dd></div>
      <div><dt className="text-muted-foreground">{t("rewards.claim.network")}</dt><dd>{t(fixed.claim.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")} · {fixed.claim.chainId}</dd></div>
      {fixed.selection ? <div><dt className="text-muted-foreground">{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={fixed.claim.chainId} kind="address" value={fixed.selection.campaignAddress}/></dd></div> : null}
    </dl>
    <RewardClaimChecklist steps={athleteClaimSteps({hr:locale === "hr",loading,failed:!!error && !progress?.signatureCollected || stopped,
      walletSelected:!!wallet,signatureCollected:!!progress?.signatureCollected,
      consented:mode === "payment" ? fixed.claim.recipientConsented : !!progress?.recipientConsented,
      approved:mode === "payment" ? fixed.claim.operatorApproved : !!progress?.operatorApproved,
      payment:payment?.confirmed ? "confirmed" : payment?.transactionHash ? "submitted" : payment ? "waiting" : "unknown",
      held:!!payment?.readinessHeld,expired:mode === "consent" && expired})}/>
    {loading ? <p role="status">{t("rewards.loading")}</p> : null}
    {error ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"><p>{t(rewardErrorKey(error))}</p>
      <p>{t(mode === "consent" ? "rewards.claim.uncertain" : "rewards.payment.errorHelp")}</p></div> : null}
    {mode === "consent" ? <>
      <p className="text-sm text-muted-foreground">{ux.claimHelp}</p>
      {progress?.recipientConsented ? <div role="status" className="space-y-2 rounded-lg bg-primary/5 p-4">
        <p className="font-semibold">{ux.claimSaved}</p>
        <p className="text-sm">{progress.operatorApproved ? ux.approved : ux.approvalPending}</p>
        <p className="text-sm">{ux.signatureHelp}</p>
      </div> : review?.status === "signature_required" && !stopped ? <>
        <p className="text-sm">{t(fixed.claim.chainId === 31337 ? "rewards.claim.localExpiry" : "rewards.claim.expiry", { time: expiry })}</p>
        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{t("rewards.wallet.message")}</summary>
          <pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(JSON.parse(athleteConsentSigningJsonV3(review)), null, 2)}</pre>
        </details>
        {expired ? <p role="status">{t("rewards.claim.error.expired")}</p> : progress?.signatureCollected ? <div className="space-y-3">
          <p role="status" className="text-sm">{t("rewards.claimV3.collected")}</p>
          <Button disabled={busy !== null} onClick={() => void act("save")}>{busy === "save" ? t("rewards.claimV3.saving") : ux.submitClaim}</Button>
        </div> : <div className="space-y-3">
          <RewardEmbeddedWalletControls />
          {embedded.status === "ready" && embedded.wallet ? <Button disabled={busy !== null} onClick={() => {setWallet(embedded.wallet); setChecked(false);}}>{locale === "hr" ? "Koristi Privy novčanik" : "Use Privy wallet"}</Button> : null}
          <div><Button variant="ghost" aria-expanded={external} disabled={busy !== null} onClick={() => {setExternal(value => !value); setWallet(null); setChecked(false);}}>{locale === "hr" ? "Napredno · vanjski novčanik" : "Advanced · external wallet"}</Button></div>
          {external ? <>
          <p className="text-sm text-muted-foreground">{t("rewards.wallet.chooseHelp")}</p>
          {wallets.length ? <div className="flex flex-wrap gap-2">{wallets.map(w => <Button key={w.id} variant={wallet?.id === w.id ? "default" : "outline"}
            aria-pressed={wallet?.id === w.id} disabled={busy !== null} onClick={() => { setWallet(w); setChecked(false); }}>{w.name ?? t("rewards.wallet.browser")}</Button>)}</div>
            : <p className="text-sm">{t("rewards.wallet.notDetected")}</p>}
          </> : null}
          {wallet ? <>
            <p className="text-sm">{t("rewards.claim.selectedWallet", { name: wallet.name ?? t("rewards.wallet.browser") })}</p>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input type="checkbox" checked={checked} disabled={busy !== null} onChange={e => setChecked(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
              <span>{t("rewards.claim.consent")}</span>
            </label>
            <Button disabled={!checked || busy !== null} onClick={() => void act("sign")}>{busy === "save" ? t("rewards.claimV3.saving") : walletActionLabel(busy === "sign" ? t("rewards.claimV3.signing") : ux.confirmClaim, wallet)}</Button>
          </> : null}
        </div>}
      </> : null}
    </> : <>
      <p className="text-sm text-muted-foreground">{t("rewards.payment.readOnly")}</p>
      {payment ? <>
        <div role="status" className="space-y-2 rounded-lg bg-secondary/60 p-4"><p className="font-semibold">{t(`rewards.paymentV3.state.${payment.state}`)}</p>
          <p className="text-sm">{t(payment.confirmed ? "rewards.payment.confirmedHelp" : "rewards.payment.unconfirmedHelp")}</p></div>
        {payment.readinessHeld ? <p className="text-sm">{t("rewards.claimV3.held")}</p> : null}
        {payment.transactionHash ? <dl className="space-y-3 text-sm">
          <div><dt className="text-muted-foreground">{t("rewards.payment.transaction")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={fixed.claim.chainId} kind="tx" value={payment.transactionHash}/></dd></div>
          {payment.confirmed ? <div><dt className="text-muted-foreground">{t("rewards.payment.paymentBlock")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={fixed.claim.chainId} kind="block" value={payment.blockNumber}/> · <RewardExplorerLink chainId={fixed.claim.chainId} kind="block" value={payment.blockNumber}>{payment.blockHash}</RewardExplorerLink></dd></div> : null}
        </dl> : null}
        <p className="text-xs text-muted-foreground">{t("rewards.payment.historical")}</p>
      </> : null}
    </>}
  </section>;
}
