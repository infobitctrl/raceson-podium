import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { useI18n } from "@/shared/i18n/I18nContext";
import { formatTestMon, type RewardAllocation } from "../model/athleteRewards";
import { roundedRewardAmount } from "../model/rewardDisplayAmount";
import { allocationTotal } from "../model/accountSummary";
import styles from "./RewardWorkspace.module.css";
import athleteStyle from "./AthleteRewards.module.css";

export default function RewardAccountSummary({ awards, complete, loading, onMore, hasMore, confirmedPaid, paymentsComplete = false, claimReadiness }: {
  claimReadiness?: {reviewable: bigint; waiting: bigint};
  confirmedPaid: bigint | null; paymentsComplete?: boolean;
  awards: Array<RewardAllocation | AthleteAllocationV3 | {chainId:31337|10143;entitlementId:string;amountWei:string}>; complete: boolean; loading: boolean; hasMore: boolean; onMore: () => void;
}) {
  const { t, locale } = useI18n(), hr = locale === "hr";
  const amount = complete ? allocationTotal(awards) : null;
  const paid = amount !== null && confirmedPaid !== null && confirmedPaid <= amount ? confirmedPaid : null;
  const display = (value: bigint) => {
    if (value === 0n) return "0";
    const rounded = roundedRewardAmount(String(value), locale);
    return `${rounded.approximate && !rounded.text.startsWith("<") ? "≈ " : ""}${rounded.text}`;
  };
  const synthetic = awards.some(a => "sourceKind" in a && (a.sourceKind === "synthetic_rehearsal" || a.ageStatus === "synthetic_test" || a.breakdown?.sourceKind === "synthetic_rehearsal"));
  if (claimReadiness) return <section aria-label={hr ? "Pregled nagrada" : "Reward summary"}>
    <div className={athleteStyle.summary}>{[
      [hr ? "Zarađene nagrade" : "Rewards earned", amount],
      [hr ? "Spremno za pregled" : "Ready for review", complete ? claimReadiness.reviewable : null],
      [hr ? "Čeka korake" : "Awaiting steps", complete ? claimReadiness.waiting : null],
      [hr ? "Preuzeto" : "Claimed", complete ? paid : null],
    ].map(([label, value]) => <div key={String(label)}><p>{String(label)}</p><strong>{typeof value === 'bigint' ? display(value) : '—'} <small>test MON</small></strong></div>)}</div>
    <p className={athleteStyle.summaryNote}>{hr ? "Spremnost i točni uvjeti ponovno se provjeravaju kada otvorite nagradu." : "Readiness and exact terms are rechecked when you open a reward."} {!complete ? (hr ? "Učitajte sve nagrade za ukupne iznose." : "Load all awards to see totals.") : ''}</p>
    {hasMore ? <button className={styles.textAction} disabled={loading} onClick={onMore}>{t("rewards.loadMore")}</button> : null}
  </section>;
  return <section className={styles.accountSummary} aria-label={hr ? "Pregled nagrada" : "Reward summary"}>
    <div><p className={styles.muted}>{hr ? "Ukupno dodijeljeno" : "Total allocated"}</p>
      <p className={styles.balance}>{amount === null ? "—" : display(amount)} <small>test MON</small></p>
      <p className={styles.smallNote}>{synthetic ? (hr ? "Sintetičke testne nagrade" : "Synthetic test allocations") : (hr ? "Svi programi" : "All programmes")}</p>
    </div>
    <div className={styles.paymentSummary}><span className={styles.muted}>{hr ? "Potvrđene isplate" : "Confirmed payments"}</span>
      <strong>{paid === null ? (hr ? "Još nije potvrđeno" : "Not yet verified") : <>{!paymentsComplete ? (hr ? "Najmanje " : "At least ") : ""}{display(paid)} <small>test MON</small></>}</strong>
      <details><summary>{hr ? "Detalji iznosa" : "Amount details"}</summary><div className={styles.summaryPopover}>
        {amount !== null ? <p>{hr ? "Dodijeljeno" : "Allocated"}: {amount === 0n ? "0" : formatTestMon(String(amount), locale)} test MON</p> : <p>{hr ? "Učitajte sve nagrade za ukupan iznos." : "Load all rewards to see the total."}</p>}
        {paid !== null ? <p>{hr ? "Potvrđeno" : "Confirmed"}: {paid === 0n ? "0" : formatTestMon(String(paid), locale)} test MON</p> : null}
        <p>{!paymentsComplete ? (hr ? "Neke isplate još nisu provjerene." : "Some payments have not been verified.") : (hr ? "Potvrde su prikazane uz nagrade." : "Receipts are shown with each reward.")}</p>
        <p>{hr ? "Dodijeljeni iznos nije stanje novčanika niti potvrda da je nagrada spremna za preuzimanje." : "Allocated rewards are not a wallet balance or a confirmation of claim availability."}</p>
      </div></details>
    </div>
    {hasMore ? <button className={styles.textAction} disabled={loading} onClick={onMore}>{t("rewards.loadMore")}</button> : null}
  </section>;
}
