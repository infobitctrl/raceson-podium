import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { productCopy } from "../model/productCopy";
import { submitRewardDestination } from "../data/athleteDestinations";
import type { PreparedWalletProof } from "../data/browserWallet";
import { rewardErrorKey } from "../model/athleteRewards";
import type { RewardDestination } from "../model/athleteDestinations";
import { athleteUxCopy } from "../model/athleteUxCopy";

export default function RewardDestinationChoice({ prepared, athleteProfileId, onSaved }: {
  prepared: PreparedWalletProof; athleteProfileId: string | null; onSaved: () => void;
}) {
  const { t, locale } = useI18n(), copy = productCopy(locale), ux = athleteUxCopy(locale);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<RewardDestination | null>(null);
  const [retryKey] = useState(() => crypto.randomUUID());
  const active = useRef(false); const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit() {
    if (!athleteProfileId || !accepted || inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await prepared.assertCurrent();
      if (!active.current) return;
      // Retain the same key on uncertain HTTP outcomes. A reload recovers the
      // committed record from private history, not browser storage or a URL.
      const result = await submitRewardDestination(prepared.challenge, athleteProfileId, retryKey);
      if (active.current) { setSaved(result); onSaved(); }
    } catch (failure) { if (active.current) setError(failure); }
    finally { if (active.current) { inFlight.current = false; setBusy(false); } }
  }
  return <div className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-semibold">{ux.saveWallet}</h3>
    <p className="text-sm text-muted-foreground">{ux.saveWalletHelp}</p>
    <details className="text-sm"><summary className="cursor-pointer">{ux.walletDetails}</summary><p className="break-all font-mono text-xs">{athleteProfileId ?? copy.selectProfile}</p></details>
    {!athleteProfileId ? <Link className="text-sm text-primary underline" to="/athlete/account?view=edit#athlete-race-history">{t("rewards.destination.error.profile")}</Link>
      : saved ? <p role="status" className="text-sm font-medium">{t(saved.status === "withdrawn" ? "rewards.destination.withdrawn" : saved.status === "identity_hold" ? "rewards.destination.identityHold" : "rewards.destination.saved")}</p>
        : <>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={accepted} disabled={busy}
              onChange={event => setAccepted(event.target.checked)} />
            <span>{t("rewards.destination.consent")}</span>
          </label>
          {error ? <div role="alert" className="space-y-1 text-sm text-destructive"><p>{t(rewardErrorKey(error))}</p><p>{t("rewards.destination.uncertain")}</p></div> : null}
          <Button disabled={!accepted || busy} onClick={() => void submit()}>{busy ? t("rewards.destination.saving") : ux.saveWallet}</Button>
        </>}
  </div>;
}
