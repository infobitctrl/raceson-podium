import {useEffect, useState} from "react";
import {RefreshCw} from "lucide-react";
import type {RewardWalletProvider} from "../data/browserWallet";
import {readSponsorWalletBalance} from "../data/sponsorWalletBalance";
import {setupAmount} from "../model/setupAmount";
import s from "./SponsorLaunch.module.css";

export default function SponsorWalletBalance({provider, address, chainId, hr}: {provider: RewardWalletProvider; address: string; chainId: number; hr: boolean}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{provider: RewardWalletProvider; address: string; chainId: number; attempt: number; balance: string | null; checkedAt: number} | null>(null);
  const t = (en: string, local: string) => hr ? local : en;
  const current = result?.provider === provider && result.address === address && result.chainId === chainId ? result : null;
  const checking = !current || current.attempt !== attempt;
  useEffect(() => {
    let active = true;
    void readSponsorWalletBalance(provider, address, chainId, () => active)
      .then(balance => {if (active) setResult({provider, address, chainId, attempt, balance, checkedAt: Date.now()});})
      .catch(() => {if (active) setResult({provider, address, chainId, attempt, balance: null, checkedAt: Date.now()});});
    return () => {active = false;};
  }, [provider, address, chainId, attempt]);
  return <div className={s.walletFunds} aria-label={t("Funding wallet funds", "Sredstva novčanika za uplatu")}>
    <div className={s.walletFundsRow}>
      <div role="status"><span>{t("Wallet balance", "Stanje novčanika")}</span><strong>{current?.balance !== null && current?.balance !== undefined ? setupAmount(BigInt(current.balance), hr) : "—"} <small>test MON</small></strong></div>
      <button className={s.textButton} disabled={checking} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true"/>{checking ? t("Checking…", "Provjera…") : t("Refresh balance", "Osvježi stanje")}</button>
    </div>
    {current?.balance !== null && current?.balance !== undefined ? <small role="status">{checking ? t("Refreshing…", "Osvježavanje…") : `${t("Updated", "Ažurirano")} ${new Date(current.checkedAt).toLocaleTimeString(hr ? "hr-HR" : "en-GB")}`}</small> : null}
    {current?.balance === null ? <p role="status">{t("Balance unavailable. Refresh to try again.", "Stanje nije dostupno. Osvježite za ponovni pokušaj.")}</p> : null}
    <p>{t("Wallet funds are separate from deposited prizes. Allow extra for the deposit fee.", "Sredstva novčanika odvojena su od uplaćenih nagrada. Ostavite dodatno za naknadu uplate.")}</p>
  </div>;
}
