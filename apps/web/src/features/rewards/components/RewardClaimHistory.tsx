import RewardExplorerLink from "./RewardExplorerLink";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon } from "../model/athleteRewards";
import type { AthleteRewardClaim } from "../model/athleteClaims";

const RewardClaimReview = lazy(() => import("./RewardClaimReview"));
const RewardClaimPayment = lazy(() => import("./RewardClaimPayment"));

export default function RewardClaimHistory({ items, pending, refreshing, hasMore, onRefresh, onMore, onAccessLost }: {
  items: AthleteRewardClaim[]; pending: boolean; refreshing: boolean; hasMore: boolean;
  onRefresh: () => void; onMore: () => void; onAccessLost: (error: unknown) => void;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<{ history: AthleteRewardClaim; mode: "consent" | "payment" } | null>(null);
  const select = (history: AthleteRewardClaim, mode: "consent" | "payment") => setSelected(current =>
    current?.history.intentId === history.intentId && current.mode === mode ? current : { history: { ...history }, mode });
  return <section className="space-y-4" aria-labelledby="reward-claims-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="reward-claims-title" className="text-lg font-semibold">{t("rewards.claim.history")}</h2>
      <Button size="sm" variant="outline" disabled={refreshing} onClick={() => { setSelected(null); onRefresh(); }}>{t("rewards.claim.refresh")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t("rewards.claim.historyHelp")}</p>
    {pending ? <p role="status">{t("rewards.loading")}</p> : items.length ? <ul className="grid gap-4 sm:grid-cols-2">
      {items.map(item => <li key={item.intentId} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t(item.pot === "race" ? "rewards.raceAward" : "rewards.leagueAward")}</h3>
          <span className="rounded-full bg-secondary px-2 py-1 text-xs">{t(item.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")}</span>
        </div>
        <p className="break-words font-semibold tabular-nums">{formatTestMon(item.amountWei, locale)} {t("rewards.testMon")}</p>
        <p className="break-all font-mono text-xs"><RewardExplorerLink chainId={item.chainId} kind="address" value={item.recipientAddress}/></p>
        <p className="text-sm">{t(item.recipientConsentRecordedAt ? "rewards.claim.recorded" : "rewards.claim.prepared")}</p>
        {item.operatorApprovalRecordedAt ? <p className="text-sm">{t("rewards.claim.operatorRecorded")}</p> : null}
        <p className="text-xs text-muted-foreground">{t("rewards.payment.openHelp")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => select(item, "consent")}>{t("rewards.claim.review")}</Button>
          <Button variant="outline" onClick={() => select(item, "payment")}>{t("rewards.payment.open")}</Button>
        </div>
      </li>)}
    </ul> : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{t("rewards.claim.empty")}</p>}
    {hasMore ? <Button variant="outline" disabled={refreshing} onClick={onMore}>{t("rewards.claim.more")}</Button> : null}
    {selected ? <Suspense fallback={<p role="status">{t("rewards.loading")}</p>}>
      {selected.mode === "payment" ? <RewardClaimPayment key={selected.history.intentId} history={selected.history} onAccessLost={onAccessLost} onClose={() => setSelected(null)} />
        : <RewardClaimReview key={selected.history.intentId} history={selected.history} onRecorded={onRefresh} onAccessLost={onAccessLost} onClose={() => setSelected(null)} />}
    </Suspense> : null}
  </section>;
}
