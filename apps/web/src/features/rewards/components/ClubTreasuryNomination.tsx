import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { submitClubTreasury } from "../data/clubTreasuries";
import { clubAccessLost, clubTreasuryErrorKey, decodeClubNomination, type ClubTreasuryNomination,
  type ClubTreasuryRequest, type RewardOwnedClub } from "../model/clubTreasuries";

const fields = ["safeAddress", "singletonAddress", "fallbackHandlerAddress", "owner1", "owner2", "owner3"] as const;
export default function ClubTreasuryNomination({ clubs, onSaved, onBack, onAccessLost }: {
  clubs: RewardOwnedClub[]; onSaved: () => void; onBack: () => void; onAccessLost: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const [clubId, setClubId] = useState(""), [values, setValues] = useState<Record<typeof fields[number], string>>({
    safeAddress: "", singletonAddress: "", fallbackHandlerAddress: "", owner1: "", owner2: "", owner3: "" });
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<ClubTreasuryNomination | null>(null), [saved, setSaved] = useState<ClubTreasuryRequest | null>(null);
  const alive = useRef(false), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  let candidate: ClubTreasuryNomination | null = null;
  try { if (clubs.some(c => c.clubId === clubId)) candidate = decodeClubNomination({ clubId, idempotencyKey: "candidate-validation",
    safeAddress: values.safeAddress.trim().toLowerCase(), singletonAddress: values.singletonAddress.trim().toLowerCase(),
    fallbackHandlerAddress: values.fallbackHandlerAddress.trim().toLowerCase(),
    owners: [values.owner1, values.owner2, values.owner3].map(v => v.trim().toLowerCase()).sort() }); } catch { /* Incomplete form stays disabled. */ }
  async function submit() {
    if (flight.current || saved || (!attempt && (!candidate || !consent))) return;
    const body = attempt ?? { ...candidate!, owners: [...candidate!.owners], idempotencyKey: crypto.randomUUID() };
    flight.current = true; setBusy(true); setAttempt(body); setError(null);
    try {
      const r = await submitClubTreasury(body);
      if (alive.current) { setSaved(r); setAttempt(null); setConsent(false); onSaved(); }
    } catch (failure) { if (alive.current) {
      setError(failure);
      if (clubAccessLost(failure)) onAccessLost(failure);
      // Only an explicit validation rejection is safe to edit/retry as new.
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 400) setAttempt(null);
    } } finally { if (alive.current) { flight.current = false; setBusy(false); } }
  }
  return <section aria-labelledby="club-nomination-title" className="space-y-4 rounded-xl border border-border bg-card p-5">
    <h2 id="club-nomination-title" className="text-xl font-semibold">{t("rewards.club.nominate")}</h2>
    <p className="text-sm text-muted-foreground">{t("rewards.club.nominationHelp")}</p>
    <p className="text-sm font-medium">{t("rewards.club.noSecrets")}</p>
    {saved ? <div role="status" className="space-y-3 rounded-lg bg-secondary p-4">
      <h3 className="font-semibold">{t("rewards.club.saved")}</h3>
      <p className="text-sm">{t(`rewards.club.status.${saved.status}`)}</p>
      <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={saved.chainId} kind="address" value={saved.candidate.safeAddress}/></p>
      <p className="text-sm">{t("rewards.club.pendingHelp")}</p>
    </div> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset disabled={busy || !!attempt} className="space-y-4">
        <label className="block space-y-1 text-sm font-medium"><span>{t("rewards.club.selectClub")}</span>
          <select className="w-full rounded-md border border-input bg-background p-2" value={clubId} onChange={e => { setClubId(e.target.value); setConsent(false); }}>
            <option value="">{t("rewards.club.chooseClub")}</option>{clubs.map(c => <option key={c.clubId} value={c.clubId}>{c.name}</option>)}
          </select></label>
        <div className="grid gap-4 sm:grid-cols-2">{fields.map(field => <label key={field} className="block min-w-0 space-y-1 text-sm font-medium">
          <span>{t(`rewards.club.field.${field}`)}</span><input type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={42}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" value={values[field]} placeholder="0x…"
            onChange={e => { setValues(old => ({ ...old, [field]: e.target.value })); setConsent(false); }} />
        </label>)}</div>
        <p className="text-xs text-muted-foreground">{t("rewards.club.addressHelp")}</p>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{t("rewards.club.consent")}</span></label>
      </fieldset>
      {error ? <div role="alert" className="space-y-2 text-sm"><p>{t(clubTreasuryErrorKey(error))}</p>{attempt ? <p>{t("rewards.club.uncertain")}</p> : null}</div> : null}
      <Button type="submit" disabled={busy || (!attempt && (!candidate || !consent))} className="h-auto whitespace-normal">
        {t(busy ? "rewards.destination.saving" : attempt ? "rewards.club.retry" : "rewards.club.submit")}</Button>
    </form>}
    <Button variant="ghost" disabled={busy} onClick={onBack}>{t("rewards.club.back")}</Button>
  </section>;
}
