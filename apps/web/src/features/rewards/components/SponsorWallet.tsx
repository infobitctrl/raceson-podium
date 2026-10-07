import RewardExplorerLink from "./RewardExplorerLink";
import SponsorWalletBalance from "./SponsorWalletBalance";
import privySymbol from "../assets/privy-symbol-white.svg";
import {useCallback, useEffect, useRef, useState} from "react";
import {useRewardEmbeddedWallet, useRewardWallets} from "./RewardEmbeddedWalletContext";
import s from "./SponsorLaunch.module.css";
import type {DetectedRewardWallet} from "../data/browserWallet";
import {LoaderCircle} from 'lucide-react';

/** Connection is a wallet preview, not a persisted funding destination or consent. */
export default function SponsorWallet({chainId, hr, onWallet, requiredAddress, compact = false, hideConnectedSummary = false, showBalance = false, balanceRevision = "", purpose = "sponsor"}: {chainId: number; hr: boolean; requiredAddress?: string; compact?: boolean; hideConnectedSummary?: boolean; showBalance?: boolean; balanceRevision?: string; purpose?: "sponsor" | "operator" | "recipient"; onWallet?: (value: {wallet: DetectedRewardWallet; address: string} | null) => void}) {
  const [editing, setEditing] = useState(false);
  const [external, setExternal] = useState(false), [choice, setChoice] = useState("");
  const [pendingPrivy, setPendingPrivy] = useState(false);
  const [connection, setConnection] = useState<{wallet: DetectedRewardWallet; address: string; chainId: number} | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const embedded = useRewardEmbeddedWallet();
  const wallets = useRewardWallets(external).filter(wallet => wallet.id !== embedded.wallet?.id);
  const selected = external ? wallets.find(w => w.id === choice)
    : chainId === 10143 && embedded.status === "ready" ? embedded.wallet : null;
  const address = connection?.wallet === selected && connection?.chainId === chainId ? connection.address : null;
  const epoch = useRef(0), flight = useRef(false), requestingAccess = useRef<number | null>(null);
  const t = (en: string, local: string) => hr ? local : en;
  useEffect(() => {onWallet?.(address && selected ? {wallet: selected, address: address.toLowerCase()} : null);}, [address, selected, onWallet]);
  useEffect(() => () => {onWallet?.(null);}, [onWallet]);
  useEffect(() => {
    epoch.current++; setConnection(null); setBusy(false); flight.current = false; setFailed(false);
    const provider = selected?.provider;
    const changed = () => {if (requestingAccess.current === epoch.current) return; epoch.current++; setConnection(null); setBusy(false); flight.current = false;};
    const events = ["accountsChanged", "chainChanged", "disconnect"];
    events.forEach(e => provider?.on(e, changed));
    return () => {epoch.current++; events.forEach(e => provider?.removeListener(e, changed));};
  }, [selected?.provider, chainId]);
  const connect = useCallback(async () => {
    if (!selected || flight.current) return;
    const ticket = epoch.current; flight.current = true; setBusy(true); setFailed(false); setConnection(null);
    try {
      const provider = selected.provider;
      requestingAccess.current = ticket;
      try {await provider.request({method: "eth_requestAccounts"});} finally {if (requestingAccess.current === ticket) requestingAccess.current = null;}
      if (ticket !== epoch.current) return;
      const accounts = await provider.request({method: "eth_accounts"});
      if (ticket !== epoch.current) return;
      const chain = await provider.request({method: "eth_chainId"});
      if (ticket !== epoch.current) return;
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])
        || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(chainId)) throw Error();
      setConnection({wallet: selected, address: accounts[0], chainId});
    } catch {if (ticket === epoch.current) setFailed(true);}
    finally {if (ticket === epoch.current) {flight.current = false; setBusy(false);}}
  }, [selected, chainId]);
  // Continue the explicit Privy choice after SDK initialization or creation.
  // Consume it once; provider changes/disconnects never silently reconnect.
  useEffect(() => {
    if (external || !pendingPrivy || !selected) return;
    setPendingPrivy(false);
    void connect();
  }, [external, pendingPrivy, selected, connect]);
  function continueWithPrivy() {
    setExternal(false); setChoice(""); setFailed(false); setPendingPrivy(true);
    if (embedded.status === "off" || embedded.status === "error") embedded.enable?.();
    else if (embedded.status === "ready" && embedded.create) {
      const ticket = epoch.current;
      void embedded.create().catch(() => {if (ticket === epoch.current) {setPendingPrivy(false); setFailed(true);}});
    }
  }
  return <section className={compact ? s.compactWallet : s.card} aria-label={purpose === "sponsor" ? t("Sponsor wallet", "Novčanik sponzora") : purpose === "operator" ? t("Operator wallet", "Operatorski novčanik") : t("Claim wallet", "Novčanik za nagrade")}>
    {!compact ? <><h2>{purpose === "sponsor" ? t("Your reward wallet", "Vaš novčanik za nagrade") : purpose === "operator" ? t("Operator wallet", "Operatorski novčanik") : t("Your reward wallet", "Vaš novčanik za nagrade")}</h2>
    <p>{purpose === "sponsor" ? t("Connect now or come back later. A deposit always needs your confirmation.", "Povežite sada ili kasnije. Uplata uvijek zahtijeva vašu potvrdu.") : t("Each signature or transaction needs your confirmation.", "Svaki potpis ili transakcija zahtijeva vašu potvrdu.")}</p>
    </> : null}
    {compact && address ? <>{!hideConnectedSummary?<p role="status">{!external ? t("Privy wallet connected and ready to use.", "Privy novčanik je povezan i spreman za korištenje.") : t("Your wallet is connected and ready to use.", "Novčanik je povezan i spreman za korištenje.")}</p>:null}<button className={`${s.textButton} ${s.walletOptions}`} aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? t("Done", "Gotovo") : t("Change", "Promijeni")}</button></> : null}
    {compact && address && !hideConnectedSummary ? <div className={s.stepAddress}><span>{!external ? t("Privy wallet", "Privy novčanik") : t("Connected wallet", "Povezani novčanik")}</span><p className={s.address}><RewardExplorerLink chainId={chainId} kind="address" value={address}/></p></div> : null}
    {showBalance && address && selected ? <SponsorWalletBalance key={balanceRevision} provider={selected.provider} address={address.toLowerCase()} chainId={chainId} hr={hr}/> : null}
    <div hidden={compact && Boolean(address) && !editing}>
    {chainId === 10143 ? <div>
      {!compact ? <h3>{t("Privy wallet", "Privy novčanik")}</h3> : null}
      {!compact ? <p>{t("Use your RacesOn account. No wallet app or browser extension needed.", "Koristite svoj RacesOn račun. Nije potrebna aplikacija ni dodatak preglednika.")}</p> : null}
      {embedded.status === "unconfigured" ? <p>{t("Privy is unavailable in this environment. Connect an existing wallet below.", "Privy nije dostupan u ovom okruženju. Povežite postojeći novčanik u nastavku.")}</p>
        : !external && address ? <p className={s.success}>{t("Privy wallet connected", "Privy novčanik povezan")}</p>
          : <button className={s.primary} disabled={busy || embedded.status === "loading"}
            aria-busy={hideConnectedSummary&&(busy||embedded.status==='loading')}
            onClick={continueWithPrivy}>
            {hideConnectedSummary&&(busy||embedded.status==='loading')?<LoaderCircle size={16} className="animate-spin" aria-hidden="true"/>:null}
            <img src={privySymbol} width={20} height={26} className="shrink-0" alt="" aria-hidden="true"/>
            {busy && !external ? t("Connecting…", "Povezivanje…")
              : embedded.status === "loading" ? t("Opening Privy…", "Otvaranje Privyja…")
                : embedded.status === "ready" && embedded.create ? t("Create my Privy wallet", "Kreiraj moj Privy novčanik")
                  : embedded.status === "error" ? t("Try Privy again", "Pokušaj ponovno s Privyjem")
                    : t("Continue with Privy", "Nastavi s Privyjem")}
          </button>}
      {embedded.status === "ready" && embedded.create ? <p>{t("Create your wallet to connect it automatically.", "Kreirajte novčanik i automatski ga povežite.")}</p> : null}
      {embedded.status === "error" ? <p role="alert">{embedded.errorReason === "initialization_timeout"
        ? t("Privy did not finish loading in this browser. Open this campaign in Chrome and sign in to the same RacesOn account, or retry here.", "Privy se nije učitao u ovom pregledniku. Otvorite ovu kampanju u Chromeu i prijavite se istim RacesOn računom ili pokušajte ponovno ovdje.")
        : t("Privy could not open your wallet. Try again or use an existing wallet.", "Privy nije mogao otvoriti novčanik. Pokušajte ponovno ili koristite postojeći novčanik.")}</p> : null}
    </div> : null}
    <div className={chainId === 10143 ? s.embedded : undefined}>
      <button className={s.secondary} aria-expanded={external} onClick={() => {
        setPendingPrivy(false); setExternal(value => !value); setChoice("");
      }}>{t("Advanced · external wallet", "Napredno · vanjski novčanik")}</button>
      {external ? <>
        <label className={s.field}>{t("Existing wallet", "Postojeći novčanik")}<select value={choice} disabled={busy} onChange={e => setChoice(e.target.value)}>
          <option value="">{t("Select wallet", "Odaberite novčanik")}</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.name ?? t("Browser wallet", "Novčanik preglednika")}</option>)}
        </select></label>
        {!wallets.length ? <p>{t("No connected wallet found.", "Nije pronađen povezani novčanik.")}</p> : null}
        <button className={s.secondary} disabled={!selected || busy} aria-busy={hideConnectedSummary&&busy} onClick={() => void connect()}>{hideConnectedSummary&&busy?<LoaderCircle size={16} className="animate-spin" aria-hidden="true"/>:null}{busy ? t("Connecting…", "Povezivanje…") : t("Connect wallet", "Poveži novčanik")}</button>
      </> : null}
    </div>
    </div>
    {address && !compact ? <p role="status" className={s.address}>{t("Connected for this visit", "Povezan za ovaj posjet")}<br/><RewardExplorerLink chainId={chainId} kind="address" value={address}/></p> : null}
    {address && requiredAddress && address.toLowerCase() !== requiredAddress.toLowerCase() ? <p role="status">{t("This wallet does not match the wallet assigned to this action. Connect the assigned account to continue.", "Ovaj novčanik ne odgovara novčaniku dodijeljenom ovoj radnji. Povežite dodijeljeni račun za nastavak.")}<br/><RewardExplorerLink chainId={chainId} kind="address" value={requiredAddress}/></p> : null}
    {failed ? <p role="alert">{t("Check your wallet and switch to the campaign network, then try again.", "Provjerite novčanik i odaberite mrežu kampanje pa pokušajte ponovno.")}</p> : null}
  </section>;
}
