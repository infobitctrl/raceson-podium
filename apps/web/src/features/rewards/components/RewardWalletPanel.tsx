import {Check} from "lucide-react";
import setup from "./RewardWalletSetup.module.css";
import RewardActionProgress from "./RewardActionProgress";
import {walletActionLabel} from "../model/walletActionLabel";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { prepareBrowserWalletProof, type DetectedRewardWallet, type PreparedWalletProof } from "../data/browserWallet";
import { useRewardEmbeddedWallet, useRewardWallets } from "./RewardEmbeddedWalletContext";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
import { rewardErrorKey, type WalletProof } from "../model/athleteRewards";
import type { TranslationKey } from "@/shared/i18n/messages";
import type { RewardDestination } from "../model/athleteDestinations";
import { productCopy } from "../model/productCopy";
import RewardDestinationChoice from "./RewardDestinationChoice";
import RewardExplorerLink from "./RewardExplorerLink";
import { athleteUxCopy } from "../model/athleteUxCopy";

export default function RewardWalletPanel({ compact = false, athleteProfileId = null, onDestinationSaved = () => {}, destinations = [], destinationsComplete = true }: {
  compact?: boolean; destinations?: RewardDestination[]; destinationsComplete?: boolean;
  athleteProfileId?: string | null; onDestinationSaved?: () => void;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale), ux = athleteUxCopy(locale);
  const [external, setExternal] = useState(false);
  const embedded = useRewardEmbeddedWallet();
  const wallets = useRewardWallets(external).filter(wallet => wallet.id !== embedded.wallet?.id);
  const [selectedWallet, setSelectedWallet] = useState<DetectedRewardWallet | null>(null);
  const [prepared, setPrepared] = useState<PreparedWalletProof | null>(null);
  const [proof, setProof] = useState<WalletProof | null>(null);
  const [proofAction,setProofAction]=useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const generation = useRef(0);
  const current = useRef<PreparedWalletProof | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { generation.current += 1; controller.current?.abort(); current.current?.dispose(); current.current = null; };
  }, []);

  function reset() {
    generation.current += 1;
    controller.current?.abort(); controller.current = null;
    current.current?.dispose(); current.current = null;
    setPrepared(null); setProof(null); setSelectedWallet(null); setErrorKey(null); setBusy(false); inFlight.current = false;
  }
  async function choose(wallet: DetectedRewardWallet) {
    if (inFlight.current) return;
    reset(); setProofAction(false); inFlight.current = true; setBusy(true);
    controller.current = new AbortController();
    const ticket = generation.current;
    try {
      const ready = await prepareBrowserWalletProof(wallet.provider, window.location.origin, () => generation.current === ticket,
        () => { if (generation.current === ticket) { reset(); setErrorKey("rewards.error.walletChanged"); } }, controller.current.signal);
      if (generation.current !== ticket) { ready.dispose(); return; }
      current.current = ready; setPrepared(ready); setSelectedWallet(wallet);
    } catch (error) { if (generation.current === ticket) setErrorKey(rewardErrorKey(error)); }
    finally { if (generation.current === ticket) { setBusy(false); inFlight.current = false; } }
  }
  async function confirm() {
    if (!prepared || inFlight.current) return;
    inFlight.current = true; setProofAction(true); setBusy(true); setErrorKey(null);
    const ticket = generation.current;
    try {
      const verified = await prepared.confirm();
      if (generation.current === ticket) setProof(verified);
    } catch (error) { if (generation.current === ticket) setErrorKey(rewardErrorKey(error)); }
    finally { if (generation.current === ticket) { setBusy(false); inFlight.current = false; } }
  }

  const existing = destinations.filter(d => d.athleteProfileId === athleteProfileId && d.status !== "withdrawn");
  if (existing.length || !destinationsComplete) return <div className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">{copy.existingDestination}</h3>
    <p className="break-all font-mono text-xs">{athleteProfileId}</p>
    {existing.map(d => <div key={d.requestId} className="space-y-1 text-sm"><p className="break-all font-mono"><RewardExplorerLink chainId={d.chainId} kind="address" value={d.address}/></p>
      <p>{t(d.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")} · {d.chainId}</p>
      <p>{t(d.status === "identity_hold" ? "rewards.destination.identityHold" : "rewards.destination.saved")}</p></div>)}
    <p className="text-sm text-muted-foreground">{copy.reuseDestination}</p>
    {!destinationsComplete ? <p className="text-sm">{t("rewards.loadMore")}</p> : null}
  </div>;
  const stage=proof?2:prepared?1:0;
  return <div className={compact?setup.flow:"space-y-4 border-t border-border pt-4"}>
    {compact?<ol className={setup.steps} aria-label={locale==="hr"?"Postavljanje novčanika":"Wallet setup"}>
      {[(locale==="hr"?"Novčanik":"Wallet"),(locale==="hr"?"Potvrdi":"Verify"),(locale==="hr"?"Spremi":"Save")].map((label,index)=><li key={label} className={index<stage?setup.done:index===stage?setup.current:undefined} aria-current={index===stage?"step":undefined}>
        <span>{index<stage?<Check aria-hidden="true" size={16}/>:index+1}</span>{label}</li>)}
    </ol>:null}
    {!compact?<details className="text-sm"><summary className="cursor-pointer">{ux.walletDetails}</summary><p className="break-all font-mono text-xs">{athleteProfileId ?? copy.selectProfile}</p></details>:null}
    {!compact||!prepared?<>{compact?<div className={setup.stepIntro}><h3>{locale==="hr"?"Odaberi novčanik":"Choose your wallet"}</h3><p>{locale==="hr"?"Poveži postojeći ili odluči stvoriti novi.":"Connect an existing wallet or choose to create one."}</p></div>:null}<RewardEmbeddedWalletControls compact={compact}/></>:null}
    {errorKey ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{t(errorKey)}</p> : null}
    {busy ? <RewardActionProgress label={locale === "hr" ? "Napredak postavljanja novčanika" : "Wallet setup progress"} labels={proofAction ? [locale === "hr" ? "Potvrda u novčaniku" : "Wallet confirmation", locale === "hr" ? "Kontrola potvrđena" : "Control verified"] : [locale === "hr" ? "Povezivanje" : "Connecting", locale === "hr" ? "Povezano" : "Connected"]} stage={0} message={t("rewards.wallet.waiting")}/> : null}
    {proof ? <div className={compact?setup.phase:"space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4"}>
      <div role="status" className="space-y-2">
      <p className="font-semibold">{t("rewards.wallet.verified")}</p>
      <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={proof.chainId} kind="address" value={proof.address}>{compact?`${proof.address.slice(0,8)}…${proof.address.slice(-6)}`:proof.address}</RewardExplorerLink></p>
      {!compact?<p className="text-sm text-muted-foreground">{t("rewards.wallet.verifiedHelp")}</p>:null}
      </div>
      {prepared ? <RewardDestinationChoice key={`${prepared.challenge.challengeId}:${athleteProfileId ?? "none"}`}
        compact={compact} prepared={prepared} athleteProfileId={athleteProfileId} onSaved={onDestinationSaved} /> : null}
    </div> : prepared ? <div className="space-y-3">
      <h3 className="font-semibold">{compact?(locale==="hr"?"Potvrdi kontrolu novčanika":"Verify wallet control"):t("rewards.wallet.review")}</h3>
      <p className="text-sm text-muted-foreground">{compact?(locale==="hr"?"Besplatan potpis. Bez plaćanja i naknade.":"A free signature. No payment or gas fee."):t("rewards.wallet.messageHelp")}</p>
      <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={prepared.challenge.chainId} kind="address" value={prepared.challenge.address}>{compact?`${prepared.challenge.address.slice(0,8)}…${prepared.challenge.address.slice(-6)}`:prepared.challenge.address}</RewardExplorerLink></p>
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("rewards.wallet.message")}</summary>
        <pre className="mt-3 whitespace-pre-wrap break-all text-xs leading-relaxed">{prepared.challenge.message}</pre>
      </details>
      <Button className={compact?setup.primary:undefined} onClick={() => void confirm()} disabled={busy}>{walletActionLabel(t("rewards.wallet.sign"), selectedWallet)}</Button>
    </div> : <div className="space-y-3">
      {embedded.status === "ready" && embedded.wallet ? <Button className={compact?setup.primary:undefined} disabled={busy} onClick={() => {void choose(embedded.wallet!)}}>{compact?(locale==="hr"?"Nastavi s ovim novčanikom":"Continue with this wallet"):(locale === "hr" ? "Koristi Privy novčanik" : "Use Privy wallet")}</Button> : null}
          <div><Button variant="ghost" aria-expanded={external} disabled={busy} onClick={() => {setExternal(value => !value); }}>{compact?(locale==="hr"?"Koristi drugi novčanik":"Use another wallet"):(locale === "hr" ? "Napredno · vanjski novčanik" : "Advanced · external wallet")}</Button></div>
          {external ? <>
          <p className="text-sm text-muted-foreground">{compact?(locale==="hr"?"Odaberi novčanik koji prepoznaješ.":"Choose a wallet you recognize."):t("rewards.wallet.chooseHelp")}</p>
      {wallets.length ? <div className="flex flex-wrap gap-2">{wallets.map(wallet => <Button key={wallet.id} variant="outline" disabled={busy}
        onClick={() => void choose(wallet)}>{wallet.name ?? t("rewards.wallet.browser")}</Button>)}</div>
        : <p className="rounded-lg bg-secondary p-3 text-sm">{compact?(locale==="hr"?"Novčanik nije pronađen. Otvori njegovu aplikaciju ili uključi proširenje.":"No wallet found. Open its app or enable its extension."):t("rewards.wallet.notDetected")}</p>}
          </> : null}
    </div>}
    {compact?<details className="text-sm"><summary className="cursor-pointer">{ux.walletDetails}</summary><p className="break-all font-mono text-xs">{athleteProfileId ?? copy.selectProfile}</p></details>:null}
    {prepared || busy || proof ? <Button variant="ghost" onClick={reset}>{t("rewards.wallet.reset")}</Button> : null}
  </div>;
}
