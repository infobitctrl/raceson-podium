import RewardExplorerLink from "./RewardExplorerLink";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { useRewardEmbeddedWallet } from "./RewardEmbeddedWalletContext";

export default function RewardEmbeddedWalletControls({ existingAddress }: { existingAddress?: string } = {}) {
  const { t, locale } = useI18n();
  const state = useRewardEmbeddedWallet();
  return <div className="space-y-3 rounded-lg border border-border p-4">
    <p className="font-medium">{t("rewards.privy.title")}</p>
    <p className="text-sm text-muted-foreground">{existingAddress ? (locale === "hr" ? "Na novom uređaju prijavite se istim RacesOn računom i ponovno povežite postojeći Privy novčanik." : "On a new device, sign in to the same RacesOn account and reconnect your existing Privy wallet.") : t("rewards.privy.help")}</p>
    {state.status === "unconfigured" ? <p className="text-sm">{t("rewards.privy.unconfigured")}</p>
      : state.status === "loading" ? <p role="status" className="text-sm">{t("rewards.privy.loading")}</p>
        : state.status === "error" ? <p role="alert" className="text-sm">{state.errorReason === "initialization_timeout"
          ? (locale === "hr" ? "Privy se nije učitao u ovom pregledniku. Otvorite ovu stranicu u Chromeu i prijavite se istim RacesOn računom ili pokušajte ponovno ovdje." : "Privy did not finish loading in this browser. Open this page in Chrome and sign in to the same RacesOn account, or retry here.")
          : t("rewards.privy.error")}</p> : null}
    {state.enable && (state.status === "off" || state.status === "error") ? <Button variant="outline" onClick={state.enable}>{existingAddress ? (locale === "hr" ? "Ponovno poveži Privy novčanik" : "Reconnect Privy wallet") : t("rewards.privy.enable")}</Button> : null}
    {!existingAddress && state.status === "ready" && state.create ? <Button variant="outline" onClick={() => void state.create?.()}>{t("rewards.privy.create")}</Button> : null}
    {existingAddress && state.status === "ready" && !state.address ? <p role="status" className="text-sm">{locale === "hr" ? "Postojeći novčanik nije dostupan. Provjerite račun ili otvorite vanjski novčanik. Spremljena adresa nije promijenjena." : "Your saved wallet is not connected. Check your account or open your external wallet. Your saved address has not changed."}</p> : null}
    {existingAddress && state.address && state.address.toLowerCase() !== existingAddress.toLowerCase() ? <p role="alert" className="text-sm">{locale === "hr" ? "Ovaj novčanik ne odgovara spremljenoj adresi za nagrade." : "This wallet does not match your saved rewards address."}</p> : null}
    {state.status === "ready" && state.address ? <div role="status" className="space-y-2">
      <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={10143} kind="address" value={state.address}/></p>
      <p className="text-sm">{t("rewards.privy.ready")}</p>
    </div> : null}
  </div>;
}
