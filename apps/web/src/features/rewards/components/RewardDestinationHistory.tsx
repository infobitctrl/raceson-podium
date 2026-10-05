import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { withdrawRewardDestination } from "../data/athleteDestinations";
import { rewardErrorKey } from "../model/athleteRewards";
import type { RewardDestination } from "../model/athleteDestinations";
import RewardExplorerLink from "./RewardExplorerLink";
import { athleteUxCopy } from "../model/athleteUxCopy";

function DestinationCard({ request, onChanged, readOnly }: { request: RewardDestination; onChanged: () => void; readOnly?: boolean }) {
  const { t, locale } = useI18n(), ux = athleteUxCopy(locale);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null); const [withdrawn, setWithdrawn] = useState(false);
  const active = useRef(false); const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const status = withdrawn ? "withdrawn" : request.status;
  async function withdraw() {
    if (!confirm || inFlight.current || status === "withdrawn") return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await withdrawRewardDestination(request.requestId);
      if (active.current) { setWithdrawn(true); setConfirm(false); onChanged(); }
    } catch (failure) { if (active.current) setError(failure); }
    finally { if (active.current) { inFlight.current = false; setBusy(false); } }
  }
  return <li className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <h3 className="font-semibold">{readOnly ? (status === "withdrawn" ? ux.removedWallet : status === "identity_hold" ? ux.held : ux.saved) : t(status === "withdrawn" ? "rewards.destination.withdrawn" : status === "identity_hold" ? "rewards.destination.identityHold" : "rewards.destination.pending")}</h3>
      <span className="rounded-full bg-secondary px-2 py-1 text-xs">{t(request.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")}</span>
    </div>
    <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={request.chainId} kind="address" value={request.address}/></p>
    <p className="text-xs text-muted-foreground">{t("rewards.destination.requested", { date: new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", { dateStyle: "medium", timeZone: "Europe/Zagreb" }).format(new Date(request.requestedAt)) })}</p>
    {!readOnly ? <p className="text-sm text-muted-foreground">{t(status === "withdrawn" ? "rewards.destination.withdrawnHelp" : status === "identity_hold" ? "rewards.destination.identityHelp" : "rewards.destination.pendingHelp")}</p> : null}
    {error ? <div role="alert" className="space-y-1 text-sm text-destructive"><p>{t(rewardErrorKey(error))}</p><p>{t("rewards.destination.uncertain")}</p></div> : null}
    {!readOnly && status !== "withdrawn" ? confirm ? <div className="space-y-3 rounded-lg bg-secondary p-3">
      <p className="text-sm">{t("rewards.destination.withdrawConfirm")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void withdraw()}>{t(busy ? "rewards.destination.saving" : "rewards.destination.confirmWithdraw")}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setConfirm(false); setError(null); }}>{t("rewards.destination.keep")}</Button>
      </div>
    </div> : <Button variant="outline" onClick={() => setConfirm(true)}>{t("rewards.destination.withdraw")}</Button> : null}
  </li>;
}

export default function RewardDestinationHistory({ items, pending, error, refreshing, hasMore, onRefresh, onMore, readOnly }: {
  items: RewardDestination[]; pending: boolean; error: unknown; refreshing: boolean; hasMore: boolean;
  onRefresh: () => void; onMore: () => void;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n(), ux = athleteUxCopy(locale);
  return <section className="space-y-4" aria-labelledby="reward-destinations-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="reward-destinations-title" className="text-lg font-semibold">{readOnly ? ux.savedWallets : t("rewards.destination.history")}</h2>
      <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>{readOnly ? ux.refreshWallet : t("rewards.destination.refresh")}</Button>
    </div>
    {!readOnly ? <p className="text-sm text-muted-foreground">{t("rewards.destination.historyHelp")}</p> : null}
    {pending ? <p role="status">{t("rewards.loading")}</p> : error ? <p role="alert">{t(rewardErrorKey(error))}</p>
      : items.length ? <ul className="grid gap-4 sm:grid-cols-2">{items.map(request => <DestinationCard key={request.requestId} request={request} readOnly={readOnly} onChanged={onRefresh} />)}</ul>
        : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("rewards.destination.empty")}</p>}
    {hasMore && !error ? <Button variant="outline" disabled={refreshing} onClick={onMore}>{t("rewards.destination.more")}</Button> : null}
  </section>;
}
