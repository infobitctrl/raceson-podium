import {walletActionLabel} from "../model/walletActionLabel";
import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getAthleteClaimReview } from "../data/athleteClaimConsent";
import { type DetectedRewardWallet } from "../data/browserWallet";
import {useRewardEmbeddedWallet, useRewardWallets} from "./RewardEmbeddedWalletContext";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import { prepareBrowserClaimConsent, type BrowserClaimConsent, type ClaimConsentResult } from "../data/browserClaimConsent";
import { athleteConsentSigningJson, type AthleteClaimReview } from "../model/athleteClaimConsent";
import { formatTestMon, rewardErrorKey } from "../model/athleteRewards";
import type { AthleteRewardClaim } from "../model/athleteClaims";

export default function RewardClaimReview({ history, onRecorded, onAccessLost, onClose }: {
  history: AthleteRewardClaim; onRecorded: () => void; onAccessLost: (error: unknown) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [review, setReview] = useState<AthleteClaimReview | null>(null), [error, setError] = useState<unknown>(null);
  const [external, setExternal] = useState(false);
  const embedded = useRewardEmbeddedWallet();
  const wallets = useRewardWallets(external).filter(wallet => wallet.id !== embedded.wallet?.id);
  const [selectedWallet, setSelectedWallet] = useState<DetectedRewardWallet | null>(null);
  const [busy, setBusy] = useState(false), [consent, setConsent] = useState(false), [ready, setReady] = useState(false);
  const [result, setResult] = useState<ClaimConsentResult | null>(null), [now, setNow] = useState(Date.now);
  const epoch = useRef(0), flight = useRef(false), flow = useRef<BrowserClaimConsent | null>(null), abort = useRef<AbortController | null>(null);
  const region = useRef<HTMLElement | null>(null);
  const lost = useRef(onAccessLost); lost.current = onAccessLost;
  useEffect(() => {
    const ticket = ++epoch.current;
    region.current?.focus();
    void getAthleteClaimReview(history).then(value => { if (epoch.current === ticket) setReview(value); }, failure => {
      if (epoch.current === ticket) {
        setError(failure);
        if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) lost.current(failure);
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { epoch.current += 1; clearInterval(timer); abort.current?.abort(); flow.current?.dispose(); flow.current = null; };
  }, [history]);
  function resetWallet() {
    epoch.current += 1; abort.current?.abort(); flow.current?.dispose(); flow.current = null;
    flight.current = false; setBusy(false); setReady(false); setConsent(false); setSelectedWallet(null);
  }
  function failed(failure: unknown) {
    setError(failure);
    if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) onAccessLost(failure);
  }
  async function choose(wallet: DetectedRewardWallet) {
    if (!review || review.state !== "awaiting_consent" || flight.current) return;
    resetWallet(); const ticket = epoch.current; flight.current = true; setBusy(true); setError(null);
    abort.current = new AbortController();
    try {
      const prepared = await prepareBrowserClaimConsent(wallet.provider, history, review, abort.current.signal, () => epoch.current === ticket,
        () => { if (epoch.current === ticket) { resetWallet(); setError({ code: "wallet_changed" }); } });
      if (epoch.current !== ticket) { prepared.dispose(); return; }
      flow.current = prepared; setReady(true); setSelectedWallet(wallet);
    } catch (failure) { if (epoch.current === ticket) failed(failure); }
    finally { if (epoch.current === ticket) { flight.current = false; setBusy(false); } }
  }
  async function sign() {
    if (!consent || !flow.current || flight.current) return;
    const ticket = epoch.current; flight.current = true; setBusy(true); setError(null);
    try {
      const saved = await flow.current.confirm();
      if (epoch.current === ticket) { setResult(saved); resetWallet(); onRecorded(); }
    } catch (failure) { if (epoch.current === ticket) failed(failure); }
    finally { if (epoch.current === ticket) { flight.current = false; setBusy(false); } }
  }
  const recorded = result ?? (review?.state === "consent_recorded" ? review : null);
  const expired = history.chainId === 10143 && BigInt(Math.floor(now / 1000)) >= BigInt(history.expiresAt);
  const expiryDate = new Date(Number(history.expiresAt) * 1000);
  const expiry = history.chainId === 31337 || !Number.isFinite(expiryDate.getTime()) ? history.expiresAt
    : new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zagreb" }).format(expiryDate);
  return <section ref={region} tabIndex={-1} className="min-w-0 space-y-4 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-6" aria-labelledby="reward-claim-review-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="reward-claim-review-title" className="text-lg font-semibold">{t("rewards.claim.review")}</h3>
      <Button size="sm" variant="ghost" onClick={onClose}>{t("rewards.claim.close")}</Button>
    </div>
    {error ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
      <p>{t(rewardErrorKey(error))}</p><p>{t("rewards.claim.uncertain")}</p>
    </div> : null}
    {!review && !error ? <p role="status">{t("rewards.loading")}</p> : null}
    {review ? <>
      <p className="break-words text-2xl font-bold tabular-nums">{formatTestMon(review.amountWei, locale)} <span className="whitespace-nowrap text-sm">{t("rewards.testMon")}</span></p>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-muted-foreground">{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={review.chainId} kind="address" value={review.recipientAddress}/></dd></div>
        <div><dt className="text-muted-foreground">{t("rewards.claim.network")}</dt><dd>{t(review.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")} · {review.chainId}</dd></div>
        <div><dt className="text-muted-foreground">{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={review.chainId} kind="address" value={review.verifyingContract}/></dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">{t("rewards.claim.paymentUnknown")}</p>
      {recorded ? <div role="status" className="space-y-2 rounded-lg bg-primary/5 p-4">
        <p className="font-semibold">{t("rewards.claim.recorded")}</p>
        <p className="text-sm">{t(recorded.operatorApprovalRecordedAt ? "rewards.claim.operatorRecorded" : "rewards.claim.operatorPending")}</p>
        <p className="text-sm">{t("rewards.claim.recordedHelp")}</p>
      </div> : review.state === "awaiting_consent" ? <>
        <p className="text-sm">{t(history.chainId === 31337 ? "rewards.claim.localExpiry" : "rewards.claim.expiry", { time: expiry })}</p>
        <p className="rounded-lg bg-secondary/60 p-3 text-sm">{t("rewards.claim.signHelp")}</p>
        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{t("rewards.wallet.message")}</summary>
          <pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(JSON.parse(athleteConsentSigningJson(review.signing)), null, 2)}</pre>
        </details>
        {expired ? <p role="status" className="text-sm">{t("rewards.claim.error.expired")}</p> : ready ? <div className="space-y-3">
          <p className="text-sm">{t("rewards.claim.selectedWallet", { name: selectedWallet?.name ?? t("rewards.wallet.browser") })}</p>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
            <span>{t("rewards.claim.consent")}</span>
          </label>
          <Button disabled={!consent || busy} onClick={() => void sign()}>{walletActionLabel(t(busy ? "rewards.claim.waiting" : "rewards.claim.sign"), selectedWallet)}</Button>
        </div> : <div className="space-y-3">
          <RewardEmbeddedWalletControls/>
          {embedded.status === "ready" && embedded.wallet ? <Button disabled={busy} onClick={() => void choose(embedded.wallet!)}>{locale === "hr" ? "Koristi Privy novčanik" : "Use Privy wallet"}</Button> : null}
          <div><Button variant="ghost" aria-expanded={external} disabled={busy} onClick={() => setExternal(value => !value)}>{locale === "hr" ? "Napredno · vanjski novčanik" : "Advanced · external wallet"}</Button></div>
          {external ? <><p className="text-sm text-muted-foreground">{t("rewards.wallet.chooseHelp")}</p>
          {wallets.length ? <div className="flex flex-wrap gap-2">{wallets.map(wallet => <Button key={wallet.id} variant="outline" disabled={busy} onClick={() => void choose(wallet)}>
            {wallet.name ?? t("rewards.wallet.browser")}</Button>)}</div> : <p className="text-sm">{t("rewards.wallet.notDetected")}</p>}</> : null}
        </div>}
        {ready || busy ? <Button variant="ghost" onClick={() => { resetWallet(); setError(null); }}>{t("rewards.wallet.reset")}</Button> : null}
      </> : null}
    </> : null}
  </section>;
}
