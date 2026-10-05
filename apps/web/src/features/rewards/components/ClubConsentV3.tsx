import {walletActionLabel} from "../model/walletActionLabel";
import RewardClaimChecklist from "./RewardClaimChecklist";
import {clubClaimSteps} from "../model/claimWorkflow";
import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useId, useRef, useState } from "react";
import type { Address } from "viem";
import type { ClubConsentReviewV3, ClubConsentSelectionV3 } from "@raceson/rewards-chain/club-consent-v3";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { createBrowserClubConsentV3, type ClubConsentProgressV3 } from "../data/browserClubConsentV3";
import {useRewardEmbeddedWallet, useRewardWallets} from "./RewardEmbeddedWalletContext";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import { getClubConsentReviewV3 } from "../data/clubConsentV3";
import { requireClaimNetwork } from "../data/athleteClaims";
import { formatTestMon, rewardErrorKey, RewardPortalError, walletAddress } from "../model/athleteRewards";
import { clubAccessLost, clubTreasuryErrorKey } from "../model/clubTreasuries";
import { productCopy } from "../model/productCopy";

type Flow = ReturnType<typeof createBrowserClubConsentV3>;
type Props = { selection: ClubConsentSelectionV3; onAccessLost: (e: unknown) => void; onClose: () => void; onRecorded: () => void };

/** Mounted only for an explicitly opened exact award. The parent is keyed by
 * Auth session and selection. No auto-sign, persisted proofs or payout action. */
export default function ClubConsentV3({ selection, onAccessLost, onClose, onRecorded }: Props) {
  const { t, locale } = useI18n(), copy = productCopy(locale).clubSigning, inputId = useId();
  const [review, setReview] = useState<ClubConsentReviewV3 | null>(null);
  const [progress, setProgress] = useState<ClubConsentProgressV3 | null>(null);
  const [external, setExternal] = useState(false), [walletId, setWalletId] = useState("");
  const embedded = useRewardEmbeddedWallet();
  const wallets = useRewardWallets(external).filter(wallet => wallet.id !== embedded.wallet?.id);
  const [signer, setSigner] = useState<Address | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState<unknown>(null), [stopped, setStopped] = useState(false);
  const flow = useRef<Flow | null>(null), abort = useRef<AbortController | null>(null), flight = useRef(false), generation = useRef(0);
  const key = JSON.stringify(selection), currentKey = useRef(key); currentKey.current = key;
  const callbacks = useRef({ onAccessLost, onRecorded }); callbacks.current = { onAccessLost, onRecorded };
  const region = useRef<HTMLElement>(null);
  const selected = external ? wallets.find(w => w.id === walletId) : embedded.status === "ready" ? embedded.wallet : null;
  useEffect(() => {
    region.current?.focus();
    const ticket = ++generation.current, controller = new AbortController(); abort.current = controller; flight.current = true;
    const current = () => !controller.signal.aborted && ticket === generation.current && currentKey.current === key;
    setReview(null); setProgress(null); setError(null); setStopped(false); setBusy(true); setSigner(null); setAcknowledged(false);
    void (async () => {
      try {
        const next = await getClubConsentReviewV3(selection); if (!current()) return;
        const instance = createBrowserClubConsentV3(selection, next, controller.signal, current, () => {
          if (current()) { setStopped(true); setSigner(null); setAcknowledged(false); setProgress(null); setError(new RewardPortalError("wallet_changed")); }
        });
        flow.current = instance; setReview(next); setProgress(instance.progress());
      } catch (e) { if (current()) { setError(e); setStopped(true); if (clubAccessLost(e)) callbacks.current.onAccessLost(e); } }
      finally { if (current()) { flight.current = false; setBusy(false); } }
    })();
    return () => { generation.current++; controller.abort(); flow.current?.dispose(); flow.current = null; flight.current = false; };
    // The serialized selection is the complete immutable identity; parent also keys it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {setSigner(null); setAcknowledged(false);}, [selected]);

  async function act(work: () => Promise<ClubConsentProgressV3 | void>) {
    if (flight.current || stopped || !flow.current || abort.current?.signal.aborted) return;
    flight.current = true; setBusy(true); setError(null); const ticket = generation.current;
    const current = () => ticket === generation.current && currentKey.current === key && !abort.current?.signal.aborted;
    try {
      requireClaimNetwork(selection.chainId);
      const next = await work(); if (!current()) return;
      if (next) { setProgress(next); setSigner(null); setAcknowledged(false); }
    } catch (e) {
      if (!current()) return; setError(e);
      // A disposed controller, stale source or expired window needs a new review.
      try { flow.current?.progress(); } catch { setStopped(true); setProgress(null); }
      if (e && typeof e === "object" && (("status" in e && [401, 403, 404, 409].includes(Number(e.status)))
        || ("code" in e && ["claim_expired", "claim_refresh_required"].includes(String(e.code))))) {
        flow.current?.dispose(); setStopped(true); setProgress(null); setSigner(null); setAcknowledged(false);
      }
      if (clubAccessLost(e)) callbacks.current.onAccessLost(e);
    } finally { if (current()) { flight.current = false; setBusy(false); } }
  }
  async function connect() {
    const wallet = selected; if (!wallet) return;
    await act(async () => {
      const ticket = generation.current;
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      if (ticket !== generation.current || abort.current?.signal.aborted || currentKey.current !== key) return;
      requireClaimNetwork(selection.chainId);
      if (!Array.isArray(accounts) || !walletAddress(accounts[0])) throw new RewardPortalError("wallet_changed");
      setSigner(accounts[0].toLowerCase() as Address); setAcknowledged(false);
    });
  }
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : null;
  const errorText = status === 409 ? copy.sourceHold : code === "club_duplicate_signer" ? copy.duplicate : code === "club_quorum_required" ? copy.needTwo
    : code === "club_quorum_collected" ? copy.collected : code === "request_pending" ? copy.busy
      : error && typeof error === "object" && "status" in error ? t(clubTreasuryErrorKey(error)) : t(rewardErrorKey(error));
  const recorded = progress?.recipientConsented === true;
  return <section ref={region} tabIndex={-1} aria-label={copy.title} className="min-w-0 space-y-4 rounded-xl border-2 border-primary/30 bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{copy.title}</h4>
      <Button variant="ghost" onClick={onClose}>{t("rewards.claim.close")}</Button></div>
    <p className="text-sm">{copy.help}</p>
    <dl className="space-y-2 text-sm">
      <div><dt>{copy.network}</dt><dd>{selection.chainId === 10143 ? "Monad testnet · 10143" : locale === "hr" ? "Lokalna simulacija · 31337" : "Local simulation · 31337"}</dd></div>
      <div><dt>{copy.amount}</dt><dd className="break-all font-semibold">{formatTestMon(selection.amountWei, locale)} {t("rewards.testMon")}</dd></div>
      <div><dt>{copy.pot}</dt><dd>{t(selection.pot === "league" ? "rewards.claimV3.league" : "rewards.clubLedger.performance")}</dd></div>
      <div><dt>{copy.safe}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={selection.recipientAddress}/></dd></div>
      <div><dt>{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={selection.chainId} kind="address" value={selection.campaignAddress}/></dd></div>
      {review ? <div><dt>{copy.expiry}</dt><dd>{new Date(Number(review.expiresAt) * 1000).toLocaleString(locale === "hr" ? "hr-HR" : "en-GB")}</dd></div> : null}
    </dl>
    <RewardClaimChecklist steps={clubClaimSteps({hr:locale === "hr",loading:!review && busy,failed:!!error,
      signatures:progress?.signaturesCollected ?? 0,recorded,stopped})}/>
    {busy ? <p role="status">{copy.busy}</p> : null}
    {error ? <p role="alert">{errorText}</p> : null}
    {stopped ? <p>{copy.restart}</p> : recorded ? <><p role="status" className="font-semibold">{copy.recorded}</p>
      <Button variant="outline" onClick={() => callbacks.current.onRecorded()}>{copy.back}</Button></>
      : review?.status === "signature_required" ? <>
        <p role="status">{copy.progress}: {progress?.signaturesCollected ?? 0} / 2</p>
        <ul className="space-y-1 break-all font-mono text-xs">{progress?.signedBy.map(address => <li key={address}><RewardExplorerLink chainId={selection.chainId} kind="address" value={address}/></li>)}</ul>
        <p className="text-xs text-muted-foreground">{copy.memory}</p>
        {progress?.signaturesCollected === 1 ? <p className="text-sm">{copy.nextOwner}</p> : null}
        {(progress?.signaturesCollected ?? 0) < 2 ? <fieldset disabled={busy} className="min-w-0 space-y-3">
          <RewardEmbeddedWalletControls/>
          <Button variant="ghost" aria-expanded={external} onClick={() => {setExternal(value => !value); setWalletId(""); setSigner(null); setAcknowledged(false);}}>{locale === "hr" ? "Napredno · vanjski novčanik" : "Advanced · external wallet"}</Button>
          {external ? <><label htmlFor={inputId} className="block text-sm">{copy.wallet}</label>
          <select id={inputId} className="w-full min-w-0 rounded-md border bg-background p-2" value={walletId}
            onChange={e => { setWalletId(e.target.value); setSigner(null); setAcknowledged(false); }}>
            <option value="">{copy.choose}</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.name ?? copy.browser}</option>)}
          </select>
          {!wallets.length ? <p className="text-sm">{copy.noWallet}</p> : null}</> : null}
          <Button variant="outline" disabled={!selected} onClick={() => void connect()}>{external ? copy.connect : locale === "hr" ? "Poveži Privy novčanik" : "Connect Privy wallet"}</Button>
          {signer ? <><p className="break-all font-mono text-sm"><RewardExplorerLink chainId={selection.chainId} kind="address" value={signer}/></p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />{copy.acknowledge}</label>
            <Button disabled={!acknowledged || !selected || progress?.signedBy.includes(signer)} onClick={() => {
              if (selected && signer) void act(() => flow.current!.collect(selected.provider, signer));
            }}>{walletActionLabel(copy.sign, selected)}</Button>
            {progress?.signedBy.includes(signer) ? <p>{copy.duplicate}</p> : null}</> : null}
        </fieldset> : <><p>{copy.collected}</p><Button disabled={busy} onClick={() => void act(() => flow.current!.submit())}>{copy.submit}</Button></>}
      </> : null}
  </section>;
}
