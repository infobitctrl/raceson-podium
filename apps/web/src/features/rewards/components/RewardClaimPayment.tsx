import RewardExplorerLink from "./RewardExplorerLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/I18nContext";
import { getAthletePaymentStatus } from "../data/athletePaymentStatus";
import type { AthleteRewardClaim } from "../model/athleteClaims";
import type { AthletePaymentStatus } from "../model/athletePaymentStatus";
import { formatTestMon, rewardErrorKey } from "../model/athleteRewards";

type View = { phase: "loading" } | { phase: "error"; error: unknown } | { phase: "ready"; payment: AthletePaymentStatus };

export default function RewardClaimPayment({ history, onAccessLost, onClose }: {
  history: AthleteRewardClaim; onAccessLost: (error: unknown) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>({ phase: "loading" });
  const epoch = useRef(0), flight = useRef(false), region = useRef<HTMLElement | null>(null);
  const lost = useRef(onAccessLost); lost.current = onAccessLost;
  const read = useCallback(async () => {
    if (flight.current) return;
    const ticket = ++epoch.current; flight.current = true; setView({ phase: "loading" });
    try {
      const payment = await getAthletePaymentStatus(history);
      if (epoch.current === ticket) setView({ phase: "ready", payment });
    } catch (error) {
      if (epoch.current === ticket) {
        setView({ phase: "error", error });
        if (error && typeof error === "object" && "status" in error && error.status === 401) lost.current(error);
      }
    } finally { if (epoch.current === ticket) flight.current = false; }
  }, [history]);
  useEffect(() => {
    region.current?.focus(); void read();
    return () => { epoch.current += 1; flight.current = false; };
  }, [read]);
  const payment = view.phase === "ready" ? view.payment : null, receipt = payment?.receipt ?? null;
  const utc = (value: string) => new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-GB", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value));
  return <section ref={region} tabIndex={-1} aria-labelledby="reward-payment-title" className="min-w-0 space-y-4 rounded-xl border-2 border-primary/30 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="reward-payment-title" className="text-lg font-semibold">{t("rewards.payment.title")}</h3>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={view.phase === "loading"} onClick={() => void read()}>{t("rewards.payment.refresh")}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>{t("rewards.claim.close")}</Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">{t("rewards.payment.readOnly")}</p>
    {view.phase === "loading" ? <p role="status">{t("rewards.loading")}</p> : view.phase === "error" ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
      <p>{t(rewardErrorKey(view.error))}</p><p>{t("rewards.payment.errorHelp")}</p>
    </div> : null}
    {payment ? <>
      <div role="status" className="space-y-2 rounded-lg bg-secondary/60 p-4">
        <p className="font-semibold">{t(`rewards.payment.status.${payment.status}`)}</p>
        <p className="text-sm">{t(receipt ? "rewards.payment.confirmedHelp" : "rewards.payment.unconfirmedHelp")}</p>
      </div>
      <p className="break-words text-2xl font-bold tabular-nums">{formatTestMon(payment.amountWei, locale)} <span className="whitespace-nowrap text-sm">{t("rewards.testMon")}</span></p>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-muted-foreground">{t("rewards.claim.destination")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={payment.chainId} kind="address" value={payment.recipientAddress}/></dd></div>
        <div><dt className="text-muted-foreground">{t("rewards.claim.network")}</dt><dd>{t(payment.chainId === 31337 ? "rewards.simulation" : "rewards.testnet")} · {payment.chainId}</dd></div>
      </dl>
      {receipt ? <>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-muted-foreground">{t("rewards.payment.transaction")}</dt><dd className="break-all font-mono">{receipt.transactionHash}</dd></div>
          <div><dt className="text-muted-foreground">{t("rewards.claim.contract")}</dt><dd className="break-all font-mono"><RewardExplorerLink chainId={payment.chainId} kind="address" value={receipt.contractAddress}/></dd></div>
          <div><dt className="text-muted-foreground">{t("rewards.payment.recordedAt")}</dt><dd>{utc(receipt.recordedAt)}</dd></div>
        </dl>
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("rewards.payment.evidence")}</summary>
          <dl className="mt-3 space-y-3 text-xs">
            <div><dt className="text-muted-foreground">{t("rewards.payment.paymentBlock")}</dt><dd className="break-all font-mono">{receipt.blockNumber} · {receipt.blockHash}</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.payment.blockTime")}</dt><dd className="break-all font-mono">{receipt.blockTimestamp}</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.payment.logIndex")}</dt><dd>{receipt.logIndex}</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.payment.finalizedBlock")}</dt><dd className="break-all font-mono">{receipt.finalizedBlock.number} · {receipt.finalizedBlock.hash}</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.payment.finalizedTime")}</dt><dd className="break-all font-mono">{receipt.finalizedBlock.timestamp}</dd></div>
            <div><dt className="text-muted-foreground">{t("rewards.payment.observedAt")}</dt><dd>{utc(receipt.observedAt)}</dd></div>
          </dl>
        </details>
        <p className="text-xs text-muted-foreground">{t("rewards.payment.historical")}</p>
      </> : null}
      <p className="text-sm text-muted-foreground">{t("rewards.payment.exactClaim")}</p>
    </> : null}
  </section>;
}
