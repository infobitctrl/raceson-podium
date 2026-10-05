import RewardExplorerLink from "./RewardExplorerLink";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { readClubTreasury, withdrawClubTreasury } from "../data/clubTreasuries";
import { clubAccessLost, clubTreasuryErrorKey, type ClubTreasuryRequest, type RewardOwnedClub } from "../model/clubTreasuries";

function TreasuryCard({ request, clubs, onAccessLost }: { request: ClubTreasuryRequest; clubs: RewardOwnedClub[]; onAccessLost: (error: unknown) => void }) {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState<ClubTreasuryRequest | null>(null), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false), [consent, setConsent] = useState(false), [uncertain, setUncertain] = useState(false);
  const alive = useRef(false), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(withdraw: boolean) {
    if (flight.current || (withdraw && (!detail || !consent))) return;
    flight.current = true; setBusy(true); setError(null);
    if (!withdraw) { setDetail(null); setConsent(false); setUncertain(false); }
    try {
      const result = await (withdraw ? withdrawClubTreasury(detail!) : readClubTreasury(request.requestId));
      if (alive.current) { setDetail(result); setConsent(false); setUncertain(false); }
    } catch (failure) { if (alive.current) {
      setError(failure); setUncertain(withdraw); if (clubAccessLost(failure)) onAccessLost(failure);
    } } finally { if (alive.current) { flight.current = false; setBusy(false); } }
  }
  const current = detail ?? request;
  return <li className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="break-words font-semibold">{clubs.find(c => c.clubId === current.clubId)?.name ?? t("rewards.club.historicalClub")}</h3>
      <span className="text-xs text-muted-foreground">{t(current.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")}</span></div>
    <p className="text-sm font-medium">{t(`rewards.club.status.${current.status}`)}</p>
    <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={current.chainId} kind="address" value={current.candidate.safeAddress}/></p>
    <p className="text-xs text-muted-foreground">{t("rewards.destination.requested", { date: new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", { dateStyle: "medium", timeZone: "Europe/Zagreb" }).format(new Date(current.requestedAt)) })}</p>
    <p className="text-sm text-muted-foreground">{t(current.status === "withdrawn" ? "rewards.club.withdrawnHelp" : current.status === "identity_hold" ? "rewards.club.holdHelp" : "rewards.club.pendingHelp")}</p>
    {detail ? <div className="space-y-3 border-t border-border pt-3">
      <dl className="space-y-2 text-xs">{([['requestId', detail.requestId], ['clubId', detail.clubId], ['singletonAddress', detail.candidate.singletonAddress],
        ['fallbackHandlerAddress', detail.candidate.fallbackHandlerAddress], ...detail.candidate.owners.map((a, i) => [`owner${i + 1}`, a])] as const).map(([field, value]) =>
        <div key={field}><dt className="font-medium">{t(`rewards.club.field.${field}` as Parameters<typeof t>[0])}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={current.chainId} kind="address" value={value}/></dd></div>)}</dl>
      {detail.status !== "withdrawn" ? <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={busy || uncertain} checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{t("rewards.club.withdrawConsent")}</span></label>
        <Button variant="outline" className="h-auto whitespace-normal" disabled={busy || !consent} onClick={() => void run(true)}>{t(uncertain ? "rewards.club.retryWithdraw" : "rewards.club.withdraw")}</Button>
      </div> : null}
    </div> : null}
    {error ? <div role="alert" className="space-y-1 text-sm"><p>{t(clubTreasuryErrorKey(error))}</p>{uncertain ? <p>{t("rewards.club.uncertainWithdraw")}</p> : null}</div> : null}
    <Button variant="ghost" className="h-auto whitespace-normal" disabled={busy} onClick={() => void run(false)}>{t(detail ? "rewards.club.refreshRequest" : "rewards.club.details")}</Button>
  </li>;
}
export default function ClubTreasuryHistory({ items, clubs, onAccessLost }: { items: ClubTreasuryRequest[]; clubs: RewardOwnedClub[]; onAccessLost: (error: unknown) => void }) {
  return <ul className="grid gap-4 sm:grid-cols-2">{items.map(request => <TreasuryCard key={request.requestId} request={request} clubs={clubs} onAccessLost={onAccessLost} />)}</ul>;
}
